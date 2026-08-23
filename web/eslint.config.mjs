import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── no-undef, which the Next preset leaves off ───────────────────────────
  //
  // It is off there because that preset assumes TypeScript, where the compiler
  // already catches an identifier that is bound nowhere. This project is plain
  // JavaScript, so nothing did — and a `taskResult` left behind by a rename sat
  // in the return statement of savePerson for weeks, throwing
  // "taskResult is not defined" on every single save AFTER the row had already
  // been written. The shortcut reported a failure that had actually succeeded.
  //
  // Nothing else in the pipeline could have caught it. The tests read source as
  // text rather than executing it, `next build` does not type-check JavaScript,
  // and the failing path was a normal success path — not an edge case anyone
  // would have thought to exercise.
  //
  // tests/no-undefined-identifiers.test.js runs this rule as part of `npm test`,
  // so it gates a deploy rather than waiting to be run by hand.
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
]);

export default eslintConfig;
