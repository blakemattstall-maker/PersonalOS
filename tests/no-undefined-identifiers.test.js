import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";


// The one test here that runs the code rather than reading it.
//
// Every other test in this directory reads a source file as a string and
// asserts against its text. That style catches a great deal, and it is blind to
// exactly one thing: an identifier that is bound nowhere. `savePerson` ended
// with
//
//     data: { person, task: taskResult?.data || null, staggerOffset }
//
// and nothing in the function ever declared `taskResult`. A rename during the
// recurring-reminders work changed the body and missed the return. Every
// save_person then threw "taskResult is not defined" — and it threw AFTER the
// row had been written, so the shortcut announced a failure that had actually
// succeeded, and the person was saved while the user was told they were not.
//
// Nothing in the pipeline could have caught it: the source-reading tests never
// execute the line, `next build` does not type-check JavaScript, and the eslint
// preset this project inherits ships `no-undef` OFF because it assumes
// TypeScript. So the rule is turned on in web/eslint.config.mjs, and this runs
// it as part of `npm test` — where it gates a deploy instead of waiting to be
// remembered.
//
// Scoped to no-undef on purpose. This is not a style gate; a stray unescaped
// apostrophe must never be able to block a fix from shipping.


const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "web");

const { ESLint } = await import(pathToFileURL(path.join(WEB, "node_modules/eslint/lib/api.js")).href);
const globals = (await import(pathToFileURL(path.join(WEB, "node_modules/globals/index.js")).href)).default;


const eslint = new ESLint({
  cwd: WEB,
  // The project config pulls in the whole Next preset — slower, and full of
  // rules that have nothing to say about this.
  overrideConfigFile: true,
  overrideConfig: {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker
      }
    },
    rules: { "no-undef": "error" }
  }
});


// Everything that runs. app/ and lib/ and tools/ are the product; proxy.js is
// the auth gate; public/ holds the service worker, which has no build step at
// all and would fail in the browser rather than anywhere visible.
const results = await eslint.lintFiles(["app", "lib", "tools", "proxy.js", "scripts", "public"]);


test("no file references an identifier that is bound nowhere", () => {

  const offences = results.flatMap(result =>
    result.messages
      .filter(m => m.ruleId === "no-undef")
      .map(m => `${path.relative(ROOT, result.filePath)}:${m.line}  ${m.message}`)
  );

  assert.deepEqual(
    offences,
    [],
    `\n\nA ReferenceError is waiting in production:\n\n  ${offences.join("\n  ")}\n\n` +
    "Each of these throws the moment the line is reached. If it sits after a\n" +
    "database write, the user is told the action failed while the data is saved.\n"
  );

});


test("the sweep actually looked at the code", () => {

  // A misconfigured cwd or a bad glob makes lintFiles return nothing, and an
  // empty result set passes the test above without having checked anything.
  assert.ok(results.length > 100, `only ${results.length} files linted — the sweep is not seeing the codebase`);

  const dirs = new Set(results.map(r => path.relative(WEB, r.filePath).split(path.sep)[0]));

  for (const required of ["app", "lib", "tools"]) {
    assert.ok(dirs.has(required), `${required}/ was not linted`);
  }

});


test("the rule this depends on is on in the project's own config too", () => {

  // The test above would keep passing off its own inline config even if someone
  // removed the rule from web/eslint.config.mjs — and then an editor, a
  // pre-commit hook, and `npm run lint` would all go quiet again.
  const config = new ESLint({ cwd: WEB });

  return config.calculateConfigForFile(path.join(WEB, "tools/people.js")).then(resolved => {

    // eslint normalises severity, so "error" comes back as 2.
    const severity = resolved.rules?.["no-undef"]?.[0];

    assert.ok(
      severity === 2 || severity === "error",
      `no-undef is ${JSON.stringify(severity)} in web/eslint.config.mjs — it has to be an error`
    );

  });

});
