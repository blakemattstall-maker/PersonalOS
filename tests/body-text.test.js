import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { splitLinks, hostLabel, speakable } from "../web/lib/linkify.js";


// The bug this file exists to keep dead:
//
// The internship digest is written as prose with raw URLs in it, and one of
// those was 86 characters of Oracle Cloud path. Dropped into a bare <p> inside
// a flex row, that single unbreakable word sized the paragraph, the paragraph
// sized the card, and the card came out 764px wide on a 375px screen — the
// whole page scrolled sideways. Measured in the browser before the fix, at
// exactly those numbers.
//
// Three separate things had to be true for the card to read properly, so all
// three are tested: the URLs become links with bounded labels, the newlines
// between entries survive, and the paragraph is allowed to be narrower than
// its longest word.


const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");


// The real thing, from the real table.
const DIGEST =
  "Vertiv — Product Management Intern - Product Marketing (Delaware, OH)\n" +
  "https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/20279047\n\n" +
  "TikTok — AI Product Manager Intern - Product Social (San Jose, CA)\n" +
  "https://lifeattiktok.com/search/7675616554318596357";


// --- splitting -----------------------------------------------------------

test("every URL in a digest becomes a link, and nothing else does", () => {

  const links = splitLinks(DIGEST).filter(p => typeof p !== "string");

  assert.equal(links.length, 2);

  assert.equal(
    links[0].url,
    "https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/20279047"
  );

  assert.equal(links[1].url, "https://lifeattiktok.com/search/7675616554318596357");

});


test("the link opens the full address but is labelled with the host", () => {

  const [link] = splitLinks(DIGEST).filter(p => typeof p !== "string");

  // The label is what bounds the width. If this ever becomes the URL again,
  // the card goes back to being wider than the phone.
  assert.equal(link.label, "egup.fa.us2.oraclecloud.com");

  assert.ok(link.label.length < 30, "a link label has to be short enough to wrap inside a card");

  // And the thing you actually tap through to is unchanged.
  assert.ok(link.url.endsWith("/job/20279047"));

});


test("the prose between the links is kept exactly, newlines and all", () => {

  const prose = splitLinks(DIGEST).filter(p => typeof p === "string").join("");

  assert.ok(prose.includes("Vertiv — Product Management Intern"));
  assert.ok(prose.includes("TikTok — AI Product Manager Intern"));

  // The blank line between the two postings is the only thing separating them
  // on screen. Collapse it and the digest reads as one run-on sentence.
  assert.ok(/\n\n/.test(prose), "the blank line between postings was lost");

});


test("a body with no URL in it comes back as one untouched string", () => {

  const plain = "You set a two-week cadence for him back in June.";

  assert.deepEqual(splitLinks(plain), [plain]);

});


test("nothing renders for an empty, missing or non-string body", () => {

  assert.deepEqual(splitLinks(""), []);
  assert.deepEqual(splitLinks(null), []);
  assert.deepEqual(splitLinks(undefined), []);
  assert.deepEqual(splitLinks({ toString: () => "https://x.com" }), []);

});


test("punctuation that ends the sentence is not swallowed into the link", () => {

  const parts = splitLinks("It's posted here (see https://example.com/jobs/12), apply today.");

  const link = parts.find(p => typeof p !== "string");

  assert.equal(link.url, "https://example.com/jobs/12");

  // The paren and comma have to survive as prose, or the sentence loses its
  // punctuation and the link 404s on a trailing bracket.
  assert.ok(parts.filter(p => typeof p === "string").join("").includes("), apply today."));

});


test("www is dropped from a label but never from the address", () => {

  const [link] = splitLinks("https://www.linkedin.com/jobs/view/4123").filter(p => typeof p !== "string");

  assert.equal(link.label, "linkedin.com");
  assert.equal(link.url, "https://www.linkedin.com/jobs/view/4123");

});


test("an address too broken to parse still renders as itself rather than blank", () => {

  // hostLabel is the only place that can throw, and a label of "" would be an
  // invisible link — worse than an ugly one.
  assert.equal(hostLabel("https://"), "https://");
  assert.ok(hostLabel("https://ok.com/a").length > 0);

});


// --- speech --------------------------------------------------------------

test("read-aloud never speaks a URL", () => {

  const spoken = speakable(DIGEST);

  assert.ok(!spoken.includes("http"), "a URL reached the speech engine");
  assert.ok(!spoken.includes("oraclecloud"));

  // What is worth hearing is still there.
  assert.ok(spoken.includes("Vertiv — Product Management Intern"));
  assert.ok(spoken.includes("TikTok — AI Product Manager Intern"));

});


test("stripping the URLs does not leave a hole where the line was", () => {

  const spoken = speakable(DIGEST);

  assert.ok(!/\n{3,}/.test(spoken), "removing a link left a run of blank lines");
  assert.ok(!/[ \t]+\n/.test(spoken), "removing a link left trailing whitespace");
  assert.equal(spoken, spoken.trim());

});


test("speech is unchanged for a body that had no links", () => {

  const plain = "The group deck is due Friday and hasn't moved since Sunday.";

  assert.equal(speakable(plain), plain);
  assert.equal(speakable(null), "");

});


// --- the layout properties, which are the actual bug ---------------------

// These read the component rather than render it. Three CSS properties are
// what stood between a readable card and a page twice the width of the phone,
// and none of them is the kind of thing anyone notices going missing in a
// refactor.
test("the body paragraph can be narrower than its longest word", () => {

  const ui = read("web/app/ui.js");

  const body = ui.slice(ui.indexOf("export function Body("));

  const className = body.match(/<p className=\{`([^`]+)`\}/);

  assert.ok(className, "could not find the Body paragraph's classes");

  // min-w-0: a flex child's default min-width is auto — "no narrower than my
  // longest word" — which is precisely how an 86-character URL got to set the
  // width of the card.
  assert.match(className[1], /min-w-0/);

  // overflow-wrap:anywhere: lets a long token break AND lets the min-content
  // width fall below it. break-word alone does only the first.
  assert.match(className[1], /overflow-wrap:anywhere/);

  // The digest's entries are separated by newlines and nothing else.
  assert.match(className[1], /whitespace-pre-wrap/);

});


test("every card in the Today queue renders its body through Body", () => {

  // A card that goes back to a bare <p> gets the bug back, and it is invisible
  // until a body happens to contain a link.
  const surfaces = [
    ["web/app/PromptCard.js", "item.body"],
    ["web/app/InsightCard.js", "item.body"],
    ["web/app/page.js", "item.message"]
  ];

  for (const [file, field] of surfaces) {

    const source = read(file);

    assert.ok(
      source.includes(`<Body text={${field}}`),
      `${file} no longer renders ${field} through Body`
    );

    assert.ok(
      !new RegExp(`<p[^>]*>\\{${field.replace(".", "\\.")}\\}`).test(source),
      `${file} renders ${field} in a bare <p> again`
    );

  }

});


test("nothing hands a raw body to the speech engine", () => {

  for (const file of ["web/app/PromptCard.js", "web/app/InsightCard.js", "web/app/page.js"]) {

    const source = read(file);

    const reads = [...source.matchAll(/<ReadAloud\s+text=\{([^}]+)\}/g)].map(m => m[1]);

    for (const expression of reads) {
      assert.match(
        expression,
        /speakable\(/,
        `${file} reads ${expression} aloud without stripping its URLs`
      );
    }

  }

});


test("the digest that caused this is in the fixtures, so it renders locally", () => {

  const fixtures = read("web/app/fixtures.js");

  assert.ok(
    fixtures.includes("egup.fa.us2.oraclecloud.com"),
    "the long-URL digest fixture is gone — the regression is no longer one page load away"
  );

});
