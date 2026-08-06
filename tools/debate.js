import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";


// The sparring half of the Practice tab. The app argues a real position —
// genuinely, not a strawman built to lose — the user responds, and at the end
// it grades the exchange. This is the part that's actually about getting
// better at debate, not just reading a digest.

const OTHER_SIDE = { side_a: "side_b", side_b: "side_a" };


async function getNewsItem(news_item_id) {

  const { data, error } = await supabase
    .from("news_items")
    .select("*")
    .eq("id", news_item_id)
    .single();

  if (error) throw new Error("Couldn't find that story.");

  return data;

}


async function getDebateTopic(debate_topic_id) {

  const { data, error } = await supabase
    .from("debate_topics")
    .select("*")
    .eq("id", debate_topic_id)
    .single();

  if (error) throw new Error("Couldn't find that topic.");

  return data;

}


// Debate now runs on two different kinds of subject: evergreen topics (the
// main deck) and news stories (kept so sessions recorded before the split
// still open, and because arguing a live story is occasionally the point).
//
// Everything downstream — opening, rebuttal, grading — only ever needed a
// title, some background, the tension, and two sides. So both shapes get
// normalised to that here, and the rest of the file stops caring which is
// which. `headline` vs `title` is the only real difference between the tables.
function normalise(row, kind) {

  return {
    kind,
    title: kind === "news" ? row.headline : row.title,
    // A news story has a summary of what happened; a standing topic doesn't
    // have an equivalent, and inventing one would just pad the prompt.
    summary: kind === "news" ? row.summary : null,
    context: row.context,
    tension: row.tension,
    side_a: row.side_a,
    side_b: row.side_b,
    used_count: row.used_count
  };

}


async function loadSubject({ debate_topic_id, news_item_id }) {

  if (debate_topic_id) {
    return normalise(await getDebateTopic(debate_topic_id), "topic");
  }

  if (news_item_id) {
    return normalise(await getNewsItem(news_item_id), "news");
  }

  throw new Error("A debate needs either a debate_topic_id or a news_item_id.");

}


async function getSession(session_id) {

  const { data, error } = await supabase
    .from("practice_sessions")
    .select("*")
    .eq("id", session_id)
    .single();

  if (error) throw new Error("Couldn't find that session.");

  return data;

}


function sideText(subject, sideKey) {
  return sideKey === "side_a" ? subject.side_a : subject.side_b;
}


export async function startDebateSession({ debate_topic_id, news_item_id, user_side }) {

  if (!["side_a", "side_b"].includes(user_side)) {
    throw new Error("startDebateSession requires user_side ('side_a' or 'side_b').");
  }

  const subject = await loadSubject({ debate_topic_id, news_item_id });

  const aiSide = OTHER_SIDE[user_side];

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [

      {
        role: "system",

        content: `You are sparring with someone practicing debate.

${subject.kind === "news" ? "The story" : "The topic"}: ${subject.title}
${subject.summary ? `What happened: ${subject.summary}` : ""}
Background: ${subject.context}
The tension: ${subject.tension}

You are arguing this position, genuinely and well — not a strawman, the
strongest honest version of it:
"${sideText(subject, aiSide)}"

The user is about to argue the opposing position:
"${sideText(subject, user_side)}"

Open with a real, specific opening argument for your side — 2-4 sentences,
direct and substantive, no throat-clearing ("That's an interesting point,
but..."). Give them something real to push back against. Do not concede
anything yet; this is your opening, not a summary of both sides.

This is a genuinely contested question and he has chosen to argue the other
side. Argue yours as its best advocate would. Do not hedge, do not add a
disclaimer about the topic being sensitive, and do not break character to
note that reasonable people disagree — he knows, that is why he picked it.`
      }

    ]

  });

  const opening = response.choices[0].message.content;

  const row = {
    type: "debate",
    user_side,
    transcript: [{ role: "assistant", message: opening }]
  };

  if (debate_topic_id) row.debate_topic_id = debate_topic_id;
  if (news_item_id) row.news_item_id = news_item_id;

  const { data: session, error } = await supabase
    .from("practice_sessions")
    .insert([row])
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Bumps the counter the topic deck sorts on, so a topic already argued drops
  // behind the ones that haven't been. Best-effort: losing the increment is
  // cosmetic, whereas failing the session the user just started is not.
  const table = debate_topic_id ? "debate_topics" : "news_items";
  const id = debate_topic_id || news_item_id;

  await supabase.from(table)
    .update({ used_count: (subject.used_count || 0) + 1 })
    .eq("id", id);

  return { success: true, session_id: session.id, message: opening };

}


export async function respondInDebate({ session_id, message }) {

  if (!session_id || !message) {
    throw new Error("respondInDebate requires session_id and message.");
  }

  const session = await getSession(session_id);

  if (session.status !== "in_progress") {
    throw new Error("This session already ended.");
  }

  const subject = await loadSubject({
    debate_topic_id: session.debate_topic_id,
    news_item_id: session.news_item_id
  });

  const aiSide = OTHER_SIDE[session.user_side];

  const transcript = [...session.transcript, { role: "user", message }];

  const history = transcript
    .map(t => `${t.role === "user" ? "User" : "You"}: ${t.message}`)
    .join("\n");

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    messages: [

      {
        role: "system",

        content: `You are continuing a debate.

${subject.kind === "news" ? "The story" : "The topic"}: ${subject.title}
The tension: ${subject.tension}

You are arguing, genuinely and well:
"${sideText(subject, aiSide)}"

Conversation so far:
${history}

Respond to what they just said — engage with their ACTUAL argument, don't
ignore it and repeat your opening. If they made a genuinely strong point,
you can concede that specific point while still defending your overall
position — a good debater doesn't pretend every point against them is weak.
If their argument has a real weakness (a logical gap, an unsupported claim,
an unaddressed consequence), press on it specifically. 2-4 sentences. Stay
in character as the other side; don't break out to grade them yet.`
      }

    ]

  });

  const reply = response.choices[0].message.content;

  transcript.push({ role: "assistant", message: reply });

  const { error } = await supabase
    .from("practice_sessions")
    .update({ transcript })
    .eq("id", session_id);

  if (error) throw new Error(error.message);

  return { success: true, message: reply };

}


export async function endDebateSession({ session_id }) {

  if (!session_id) throw new Error("endDebateSession requires session_id.");

  const session = await getSession(session_id);

  if (session.status === "completed") {
    return { success: true, alreadyCompleted: true, feedback: session.feedback };
  }

  const history = session.transcript
    .map(t => `${t.role === "user" ? "User" : "Opponent"}: ${t.message}`)
    .join("\n");

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Grade this debate exchange. Be blunt and specific — this
user has explicitly said he wants direct feedback, not encouragement for its
own sake. The goal is he actually gets better at this.

Full exchange:
${history}

Evaluate the USER's turns only (not the opponent's, which was you). Return
ONLY JSON:
{
  "overall": "1-2 sentences, direct verdict on how they did",
  "strengths": ["specific thing they did well, with why it worked"],
  "weaknesses": ["specific thing that weakened their argument, with why"],
  "conceded_unnecessarily": ["a point where they gave ground they didn't need to, if any"],
  "fallacies_noted": ["a specific logical gap or fallacy, if any — name it and quote the line"],
  "one_thing_to_work_on": "the single highest-leverage thing to improve next time"
}

Omit items from an array (return empty) rather than padding it with something
weak just to fill it.`
      }

    ]

  });

  const feedback = JSON.parse(response.choices[0].message.content);

  const { error } = await supabase
    .from("practice_sessions")
    .update({ feedback, status: "completed", completed_at: new Date().toISOString() })
    .eq("id", session_id);

  if (error) throw new Error(error.message);

  return { success: true, feedback };

}
