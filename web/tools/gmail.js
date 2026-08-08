import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { getGoogleClient } from "../lib/google.js";
import { MODELS } from "../lib/models.js";
import { buildRichContext } from "../lib/context.js";
import { mapWithConcurrency } from "../lib/async.js";


// Email drafting. DRAFTS ONLY — this file never sends anything, ever.
//
// That is a hard product requirement, not a default: the user asked for it
// explicitly and twice. It is enforced three ways, because a comment alone is
// worth nothing:
//
//   1. The only Gmail method called anywhere in this file is
//      `gmail.users.drafts.create`. There is no code path to either of the
//      send endpoints — not behind a flag, not behind a confirmation.
//   2. tests/gmail-never-sends.test.js greps the whole repo for those two
//      method names and fails the suite if one ever appears. (Which is why
//      this comment describes them instead of spelling them out.)
//   3. The tool description the model sees says the draft is saved for review
//      and NOT sent, so it never tells the user their mail went out.
//
// The OAuth scope (gmail.compose) does technically permit sending — Google
// publishes no drafts-only scope — so points 1 and 2 are the actual guarantee.


// RFC 2822 needs CRLF line endings between headers. Gmail is lenient about it
// in practice but the spec isn't, and a bare \n has historically produced
// drafts where the body is swallowed into the last header.
function buildRawMessage({ to, subject, body }) {

  const headers = [
    to ? `To: ${to}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8"
  ].filter(Boolean);

  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;

  // Gmail wants base64url (- and _ instead of + and /), unpadded.
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

}


// "Draft an email to Sarah" — the user says a name, not an address. People
// already saved through the relationship feature carry an email, so resolve
// against that before giving up. A miss is not an error: a draft with no
// recipient is still a useful draft, it just needs the To field filled in by
// hand, which is exactly the review step this feature is built around.
async function resolveRecipient(recipient) {

  if (!recipient) return { to: null, note: "No recipient — fill in the To field before sending." };

  if (recipient.includes("@")) return { to: recipient, note: null };

  const { data } = await supabase
    .from("people")
    .select("name, email")
    .ilike("name", `%${recipient}%`)
    .limit(2);

  const withEmail = (data || []).filter(p => p.email);

  if (withEmail.length === 1) {
    return { to: withEmail[0].email, note: null };
  }

  if (withEmail.length > 1) {
    return {
      to: null,
      note: `More than one saved person matches "${recipient}" — set the recipient by hand.`
    };
  }

  return {
    to: null,
    note: `No email saved for "${recipient}" — the draft is ready, add the address before sending.`
  };

}


async function compose({ about, recipientName, tone, context }) {

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Write an email on the user's behalf. He will read and edit it
before it goes anywhere — it is being saved as a draft, never sent — so aim
for "90% there and clearly his voice", not "safe and generic".

What he wants to say: ${about}
${recipientName ? `Who it's going to: ${recipientName}` : "Recipient not specified."}
${tone ? `Tone he asked for: ${tone}` : ""}

${context ? `Background on him, for voice and relevant detail. Use it only where it genuinely belongs — do not stuff facts in to prove you know them:\n${context}` : ""}

Rules:
- Real, plain English. No "I hope this email finds you well", no "I wanted to
  reach out", no throat-clearing before the point.
- Get to the ask or the point in the first two sentences.
- Do not invent specifics — dates, numbers, commitments, names — that he did
  not give you. If a detail is needed and missing, leave an obvious [bracket]
  for him to fill rather than guessing plausibly. A plausible invention is
  much worse than a visible blank, because he might not catch it.
- Sign off as him, but do not invent a title or company.

Return ONLY JSON:
{
  "subject": "a real subject line, specific, no colon-heavy jargon",
  "body": "the email body, with real line breaks",
  "blanks": ["each [bracket] you left and what it needs, if any"]
}`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


export async function draftEmail({ about, to, tone }) {

  if (!about) throw new Error("draftEmail needs to know what the email should say.");

  const { auth, google } = await getGoogleClient();
  const gmail = google.gmail({ version: "v1", auth });

  const { to: address, note } = await resolveRecipient(to);

  // Voice and relevant background. Non-fatal if it fails — an email written
  // without the profile is still a usable draft, whereas refusing to draft
  // because a context read timed out would be absurd.
  const context = await buildRichContext({ query: about }).catch(() => null);

  const written = await compose({
    about,
    recipientName: to || null,
    tone,
    context: context && [context.bio, context.memories].filter(Boolean).join("\n\n")
  });

  const raw = buildRawMessage({
    to: address,
    subject: written.subject,
    body: written.body
  });

  // The ONLY Gmail write in this codebase. See the header comment.
  const created = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } }
  });

  const draftId = created.data.id;

  const blanks = (written.blanks || []).filter(Boolean);

  const spoken = [
    `Draft saved${address ? ` to ${address}` : ""}, not sent.`,
    `Subject: ${written.subject}.`,
    note,
    blanks.length ? `You'll need to fill in ${blanks.length} blank${blanks.length === 1 ? "" : "s"} before it's ready.` : null
  ].filter(Boolean).join(" ");

  return {
    success: true,
    message: spoken,
    data: {
      draft_id: draftId,
      // Deep link straight to the draft in Gmail's web UI.
      url: `https://mail.google.com/mail/u/0/#drafts?compose=${draftId}`,
      to: address,
      subject: written.subject,
      body: written.body,
      blanks,
      recipientNote: note,
      sent: false
    }
  };

}


// ---------------------------------------------------------------------------
// Reading. Still never sending.
// ---------------------------------------------------------------------------
//
// The inbox is the richest passive signal this system can reach: what he
// actually committed to, who is waiting on him, and which deadlines exist that
// nobody ever put in a calendar. Everything else in PersonalOS depends on him
// remembering to say something out loud; this does not.
//
// Two deliberate limits, both about restraint rather than capability:
//
//   - format: "metadata" only. Headers and Gmail's own snippet, never the
//     message body. The scope permits reading everything; this code reads the
//     least that still answers the question, and a body is almost never needed
//     to tell a real commitment from a newsletter.
//   - Nothing is written to memory from here automatically. It returns what it
//     found and the caller decides. An inbox is full of other people's claims,
//     and treating those as facts about the user is how a memory store fills up
//     with things that were never true.

const INBOX_QUERY = "-in:chats -category:promotions -category:social -category:forums";

const RE_AUTH_HINT =
  "Reading your inbox needs one more Google permission than drafting does. " +
  "Open /api/auth/google/login once to grant it — nothing else needs to change.";


function headerMap(headers = []) {
  const out = {};
  for (const h of headers) out[(h.name || "").toLowerCase()] = h.value || "";
  return out;
}


// "Ada Lovelace <ada@example.com>" -> { name, email }
function parseFrom(value = "") {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  return { name: "", email: value.trim().toLowerCase() };
}


export async function readInbox({ days = 7, limit = 40 } = {}) {

  const { auth, google } = await getGoogleClient();

  const gmail = google.gmail({ version: "v1", auth });

  let listed;

  try {

    listed = await gmail.users.messages.list({
      userId: "me",
      maxResults: Math.min(limit, 100),
      q: `newer_than:${days}d ${INBOX_QUERY}`
    });

  } catch (error) {

    // The one failure worth naming precisely. Everything else is a real error.
    if (error?.code === 403 || /insufficient authentication scopes/i.test(error?.message || "")) {
      return { success: false, needsReauth: true, message: RE_AUTH_HINT };
    }

    throw error;

  }


  const ids = (listed.data.messages || []).map(m => m.id);

  if (ids.length === 0) {
    return { success: true, count: 0, message: `Nothing in the last ${days} days.`, data: { messages: [] } };
  }


  const messages = (await mapWithConcurrency(ids, async (id) => {

    try {

      const { data } = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"]
      });

      const head = headerMap(data.payload?.headers);
      const from = parseFrom(head.from);

      return {
        id,
        from: from.name || from.email,
        email: from.email,
        subject: head.subject || "(no subject)",
        date: head.date || null,
        snippet: (data.snippet || "").replace(/\s+/g, " ").trim().slice(0, 300),
        unread: (data.labelIds || []).includes("UNREAD")
      };

    } catch (error) {
      return null;
    }

  }, 5)).filter(Boolean);


  // Anyone already saved gets attached by address, so the caller can tie a
  // message to a real relationship rather than a bare string.
  const { data: people } = await supabase.from("people").select("id, name, email, relationship");

  const byEmail = new Map(
    (people || []).filter(p => p.email).map(p => [p.email.toLowerCase(), p])
  );

  for (const message of messages) {
    const known = byEmail.get(message.email);
    if (known) message.person = { id: known.id, name: known.name, relationship: known.relationship };
  }


  return {
    success: true,
    count: messages.length,
    data: { messages, days }
  };

}


// The reasoning layer over the above. Separate on purpose: readInbox() is a
// pure read that any other tool can reuse, and this is the expensive pass that
// turns it into something worth interrupting him about.
export async function reviewInbox({ days = 7, limit = 40, question = null } = {}) {

  const inbox = await readInbox({ days, limit });

  if (!inbox.success) return inbox;

  if (inbox.count === 0) return { success: true, message: inbox.message, data: { items: [] } };


  const [context, { data: people }] = await Promise.all([
    buildRichContext().catch(() => ""),
    supabase.from("people").select("name, relationship")
  ]);

  const roster = (people || []).map(p => `${p.name} (${p.relationship || "?"})`).join(", ");

  const lines = inbox.data.messages.map((m, i) =>
    `${i + 1}. from ${m.from} <${m.email}>${m.person ? ` [saved: ${m.person.name}]` : ""}` +
    `${m.unread ? " [unread]" : ""}\n   subject: ${m.subject}\n   ${m.snippet}`
  ).join("\n\n");


  const completion = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [
      {
        role: "system",
        content:
          "You are reading the last few days of one person's inbox and reporting only what genuinely " +
          "needs them. Be blunt and specific; they have asked never to have things softened.\n\n" +
          "Return JSON:\n" +
          "{\n" +
          '  "needs_you": [{"subject":"","from":"","why":"","deadline":"YYYY-MM-DD or null"}],\n' +
          '  "commitments": [{"what":"","who":"","direction":"i_owe|they_owe"}],\n' +
          '  "people_facts": [{"person":"","fact":""}],\n' +
          '  "summary": ""\n' +
          "}\n\n" +
          "Rules that matter:\n" +
          "- needs_you means a real action or reply is required of them. Newsletters, receipts, " +
          "notifications and marketing are never needs_you, no matter how urgent the sender writes.\n" +
          "- Only record a deadline the message actually states. Never infer one from tone.\n" +
          "- people_facts must be durable facts about a person they know, not the contents of one " +
          "message. Only use names from the saved roster. If nothing qualifies, return an empty list.\n" +
          "- An inbox is full of other people's assertions. Do not restate a sender's claim as fact.\n" +
          "- Empty lists are the correct answer when nothing qualifies. Do not pad."
      },
      {
        role: "user",
        content:
          (context ? `Who they are:\n${context}\n\n` : "") +
          (roster ? `People they have saved: ${roster}\n\n` : "") +
          (question ? `They specifically asked: ${question}\n\n` : "") +
          `Inbox, last ${days} days:\n\n${lines}`
      }
    ]

  });


  let verdict;

  try {
    verdict = JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    return { success: false, message: "Could not read the inbox summary back.", data: { raw: completion.choices[0].message.content } };
  }


  const needs = verdict.needs_you || [];

  return {

    success: true,

    message: verdict.summary ||
      (needs.length ? `${needs.length} thing${needs.length === 1 ? "" : "s"} in your inbox need you.` : "Nothing in your inbox needs you."),

    data: {
      needs_you: needs,
      commitments: verdict.commitments || [],
      people_facts: verdict.people_facts || [],
      scanned: inbox.count,
      days
    }

  };

}
