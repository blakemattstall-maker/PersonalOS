// Turning written text into something a card can safely render.
//
// The internship digest is written as prose with raw URLs in it — that is the
// right shape for a push body and for anything read back later, and it is the
// wrong shape for a 375px-wide card. An 86-character Oracle Cloud link is one
// unbreakable word, so a browser sizes the paragraph to fit it, the card grows
// to fit the paragraph, and the page ends up twice the width of the screen.
//
// So the splitting happens here, in a pure function, rather than in the
// component: the rules are testable, and every surface that renders a body
// gets the same answer. See app/ui.js — Body is the twenty lines of JSX left
// once this file has done the work.


// A URL and only a URL. The excluded set is whitespace and the quoting
// characters, which is enough — trailing sentence punctuation is trimmed
// separately below, because "." is legal inside a URL and illegal at the end
// of one in running prose.
export const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;


// Punctuation that ends a sentence or closes a bracket around a link belongs
// to the prose, not to the address: "(see https://x.com/a)." must not link the
// paren.
const TRAILING = /[.,;:!?)\]}>]+$/;


// What a link should SAY.
//
// Nobody reads a job board's URL — the line above it already names the company
// and the role — so the address is shown as its host. That is also what makes
// overflow structurally impossible rather than merely handled: a hostname has
// a bounded length, and the full URL is still what gets opened.
export function hostLabel(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}


// The text broken into a flat list of pieces, in order: strings for prose and
// { url, label } for the links. Never returns an empty prose piece, so a body
// that is nothing but a URL yields exactly one segment.
export function splitLinks(text) {

  const source = typeof text === "string" ? text : "";

  if (!source) return [];

  const parts = [];
  let cursor = 0;

  for (const match of source.matchAll(URL_PATTERN)) {

    const url = match[0].replace(TRAILING, "");

    if (match.index > cursor) parts.push(source.slice(cursor, match.index));

    parts.push({ url, label: hostLabel(url) });

    cursor = match.index + url.length;

  }

  if (cursor < source.length) parts.push(source.slice(cursor));

  return parts;

}


// The same text with its links removed, for speech.
//
// Read aloud, an 86-character Oracle Cloud URL is the better part of a minute
// of spelt-out consonants, and it is the one part of the card that carries no
// information a listener can use.
export function speakable(text) {
  return String(text || "")
    .replace(URL_PATTERN, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
