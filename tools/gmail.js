import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { getGoogleClient } from "../lib/google.js";
import { MODELS } from "../lib/models.js";
import { buildRichContext } from "../lib/context.js";


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
