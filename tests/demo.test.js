import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { showcaseSession, SHOWCASE_PREFIX } from "../web/lib/demo.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const sessionSource = read("web/lib/demo.js");
const proxySource = read("web/proxy.js");
const backendSource = read("web/app/backend.js");
const loginSource = read("web/app/login/page.js");
const showcaseSource = read("web/app/showcase/page.js");
const welcomeSource = read("web/app/welcome/page.js");

test("the showcase session is derived from the owner secret, not a public constant", () => {
  assert.equal(SHOWCASE_PREFIX, "showcase:");
  assert.equal(showcaseSession("owner-secret"), "showcase:owner-secret");
  assert.equal(showcaseSession(""), null);
  assert.doesNotMatch(sessionSource, /next\/headers|cookies\(/);
});

test("the proxy admits only the derived showcase session", () => {
  assert.match(proxySource, /showcaseSession\(passphrase\)/);
  assert.match(proxySource, /cookie\?\.value === showcaseSession\(passphrase\)/);
  assert.match(proxySource, /passphrase && cookie\?\.value === passphrase/);
});

test("the public login and welcome page no longer offer a demo passphrase", () => {
  assert.doesNotMatch(loginSource, /DEMO_SESSION|passphrase demo|read-only tour/i);
  assert.doesNotMatch(welcomeSource, /enterDemo|Open the live demo|Try the demo/);
});

test("the private showcase requires the real owner passphrase", () => {
  assert.match(showcaseSource, /supplied !== ownerPassphrase/);
  assert.match(showcaseSource, /showcaseSession\(ownerPassphrase\)/);
  assert.match(showcaseSource, /maxAge: 60 \* 60 \* 2/);
  assert.match(showcaseSource, /robots: \{ index: false, follow: false \}/);
});

test("a showcase read is answered from fixtures and cannot fall through", () => {
  const get = backendSource.slice(backendSource.indexOf("export async function backendGet"), backendSource.indexOf("export async function backendPost"));
  const fixture = get.indexOf("fixtureFor(path)");
  const deadEnd = get.indexOf('if (demo) return { success: false, demo: true');
  const realCall = get.indexOf('invoke({ method: "GET", path })');
  assert.ok(fixture > 0);
  assert.ok(deadEnd > fixture);
  assert.ok(realCall > deadEnd);
});

test("a showcase write is refused before it reaches a handler", () => {
  const post = backendSource.slice(backendSource.indexOf("export async function backendPost"));
  const refusal = post.indexOf("The demo is read-only.");
  const realCall = post.indexOf('invoke({ method: "POST"');
  assert.ok(refusal > 0 && refusal < realCall);
});

test("an unauthenticated server action is refused before invoke", () => {
  for (const source of [
    backendSource.slice(backendSource.indexOf("export async function backendGet"), backendSource.indexOf("export async function backendPost")),
    backendSource.slice(backendSource.indexOf("export async function backendPost"))
  ]) {
    assert.ok(source.indexOf('kind === "none"') > 0);
    assert.ok(source.indexOf('kind === "none"') < source.indexOf("invoke({"));
  }
});
