import openai from "../lib/openai.js";
import { getGoogleClient } from "../lib/google.js";
import { MODELS } from "../lib/models.js";
import { runWebSearch } from "./research.js";
import { buildRichContext } from "../lib/context.js";


// Export something to a real Google Doc.
//
// The point is the things this system produces that are too long to be spoken
// back and too structured to live in a note — an interview question list, a
// prep sheet, a comparison. Those want a real document: readable on a phone,
// editable, shareable with someone who has never heard of PersonalOS.
//
// Docs are created inside a "PersonalOS" folder rather than dumped in the root
// of Drive, which is why this needs drive.file (per-file access to files this
// app created — it cannot see anything else in Drive).
//
// Documents are NOT shared with anyone on creation. Sharing is an outward
// action with real consequences, so it stays a deliberate click in Google's
// own UI rather than something a voice command can trigger by accident.

const FOLDER_NAME = "Almanac";


// ---------------------------------------------------------------------------
// Markdown -> Docs requests
// ---------------------------------------------------------------------------
//
// The Docs API has no markdown import. Without this the whole document arrives
// as one undifferentiated block of plain text, which defeats the entire reason
// for exporting to Docs instead of saving a note.
//
// Every request below is index-stable: the text is inserted once, in full,
// and every styling request afterwards refers to final offsets. Interleaving
// inserts and styles instead would shift every subsequent index and silently
// mis-format the back half of the document.

function stripBold(line) {

  const bolds = [];

  let clean = "";
  let i = 0;

  while (i < line.length) {

    if (line[i] === "*" && line[i + 1] === "*") {

      const close = line.indexOf("**", i + 2);

      // An unmatched ** is literal text, not the start of a run that swallows
      // the rest of the paragraph.
      if (close === -1) {
        clean += line[i];
        i += 1;
        continue;
      }

      const inner = line.slice(i + 2, close);

      bolds.push({ start: clean.length, end: clean.length + inner.length });

      clean += inner;
      i = close + 2;

      continue;

    }

    clean += line[i];
    i += 1;

  }

  return { clean, bolds };

}


function classify(rawLine) {

  const line = rawLine.trimEnd();

  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  if (heading) {
    return { kind: "heading", level: heading[1].length, content: heading[2] };
  }

  const bullet = line.match(/^\s*[-*]\s+(.*)$/);
  if (bullet) {
    return { kind: "bullet", content: bullet[1] };
  }

  const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
  if (numbered) {
    return { kind: "numbered", content: numbered[1] };
  }

  return { kind: "paragraph", content: line };

}


export function markdownToRequests(markdown, startIndex = 1) {

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  let text = "";

  const paragraphs = [];
  const bolds = [];

  for (const rawLine of lines) {

    const { kind, level, content } = classify(rawLine);

    const { clean, bolds: lineBolds } = stripBold(content);

    const offset = text.length;

    for (const b of lineBolds) {
      bolds.push({
        start: startIndex + offset + b.start,
        end: startIndex + offset + b.end
      });
    }

    paragraphs.push({
      kind,
      level,
      // The range deliberately includes the trailing newline — a paragraph
      // style applied to a range that stops short of it does not take.
      start: startIndex + offset,
      end: startIndex + offset + clean.length + 1
    });

    text += `${clean}\n`;

  }

  const requests = [
    { insertText: { location: { index: startIndex }, text } }
  ];

  for (const p of paragraphs) {

    if (p.kind !== "heading") continue;

    requests.push({
      updateParagraphStyle: {
        range: { startIndex: p.start, endIndex: p.end },
        paragraphStyle: { namedStyleType: `HEADING_${p.level}` },
        fields: "namedStyleType"
      }
    });

  }

  // Consecutive list items are merged into one range per run. Issuing one
  // createParagraphBullets per line also works but produces a request per
  // bullet, and a long document hits the batch size limit for no reason.
  let run = null;

  const flush = () => {

    if (!run) return;

    requests.push({
      createParagraphBullets: {
        range: { startIndex: run.start, endIndex: run.end },
        bulletPreset: run.kind === "numbered"
          ? "NUMBERED_DECIMAL_ALPHA_ROMAN"
          : "BULLET_DISC_CIRCLE_SQUARE"
      }
    });

    run = null;

  };

  for (const p of paragraphs) {

    if (p.kind !== "bullet" && p.kind !== "numbered") {
      flush();
      continue;
    }

    if (run && run.kind === p.kind && run.end === p.start) {
      run.end = p.end;
      continue;
    }

    flush();

    run = { kind: p.kind, start: p.start, end: p.end };

  }

  flush();

  for (const b of bolds) {

    // A ** ** with nothing inside produces a zero-length range, which the API
    // rejects outright rather than ignoring.
    if (b.end <= b.start) continue;

    requests.push({
      updateTextStyle: {
        range: { startIndex: b.start, endIndex: b.end },
        textStyle: { bold: true },
        fields: "bold"
      }
    });

  }

  return requests;

}


// ---------------------------------------------------------------------------
// Drive folder
// ---------------------------------------------------------------------------

async function ensureFolder(drive) {

  // drive.file scope means this only ever sees folders this app created, so
  // the search cannot collide with a "PersonalOS" folder the user made
  // themselves — it would simply be invisible here and a second one created.
  const { data } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1
  });

  if (data.files?.length) return data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    },
    fields: "id"
  });

  return created.data.id;

}


// ---------------------------------------------------------------------------
// Content generation
// ---------------------------------------------------------------------------

async function writeDocument({ request, research, context }) {

  const researched = research
    ? await runWebSearch({ query: request }).catch(() => null)
    : null;

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Produce a real, useful document for the user. It is going
straight into a Google Doc he will read on a phone and possibly send to
someone else, so it has to stand on its own — no "here's what I came up with",
no meta-commentary, no closing offer to help further.

What he asked for: ${request}

${researched ? `Live web research, already performed for this request. Use these findings as the factual basis and do NOT contradict them. Where you use a specific fact from here, it is real and citable:\n\n${researched.answer}\n\nSources:\n${researched.sources.map(s => `- ${s.title}: ${s.url}`).join("\n")}` : "No web research was performed — rely on general knowledge, and do not state specific current figures, prices, or recent events as fact."}

${context ? `Background on the user, for relevance and voice:\n${context}` : ""}

Format the body as markdown, using only:
  # / ## / ###   headings
  - item         bullets
  1. item        numbered lists
  **bold**       emphasis
Nothing else — no tables, no code fences, no links in bracket syntax. Write
URLs bare if you need them.

Be substantive. A document worth exporting has real specifics, not a generic
outline anyone could have written from the title alone.${researched ? " End with a '## Sources' section listing the real URLs used." : ""}

Return ONLY JSON:
{
  "title": "a real document title, no date, no 'Draft:' prefix",
  "markdown": "the full document body"
}`
      }

    ]

  });

  const doc = JSON.parse(response.choices[0].message.content);

  return { ...doc, sources: researched?.sources || [] };

}


// ---------------------------------------------------------------------------

export async function exportToDoc({ request, title, research = false, markdown }) {

  if (!request && !markdown) {
    throw new Error("exportToDoc needs either a request to write about, or markdown to export.");
  }

  const { auth, google } = await getGoogleClient();

  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  let body = markdown;
  let docTitle = title;
  let sources = [];

  if (!body) {

    const context = await buildRichContext({ query: request }).catch(() => null);

    const written = await writeDocument({
      request,
      research,
      // memoriesText, not memories — the object stringified to
      // "[object Object]" here, so documents drew on the bio alone.
      context: context && [context.bio, context.memoriesText].filter(Boolean).join("\n\n")
    });

    body = written.markdown;
    docTitle = title || written.title;
    sources = written.sources;

  }

  const created = await docs.documents.create({
    requestBody: { title: docTitle || "Almanac export" }
  });

  const documentId = created.data.documentId;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests: markdownToRequests(body) }
  });

  // Filing it away is a convenience, not the point of the operation — a doc
  // that was written and then failed to move is still a doc the user wants.
  let folderNote = null;

  try {

    const folderId = await ensureFolder(drive);

    await drive.files.update({
      fileId: documentId,
      addParents: folderId,
      fields: "id, parents"
    });

  } catch (error) {
    folderNote = `Saved to the root of your Drive rather than the Almanac folder (${error.message}).`;
  }

  const url = `https://docs.google.com/document/d/${documentId}/edit`;

  return {
    success: true,
    message: `Created the doc "${docTitle}"${folderNote ? "" : " in your Almanac folder"}. It's private to you — open it to read or share it.${folderNote ? ` ${folderNote}` : ""}`,
    data: {
      document_id: documentId,
      url,
      title: docTitle,
      sources,
      shared: false
    }
  };

}
