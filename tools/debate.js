import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";


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


async function getSession(session_id) {

  const { data, error } = await supabase
    .from("practice_sessions")
    .select("*")
    .eq("id", session_id)
    .single();

  if (error) throw new Error("Couldn't find that session.");

  return data;

}


function sideText(newsItem, sideKey) {
  return sideKey === "side_a" ? newsItem.side_a : newsItem.side_b;
}


export async function startDebateSession({ news_item_id, user_side }) {

  if (!news_item_id || !["side_a", "side_b"].includes(user_side)) {
    throw new Error("startDebateSession requires news_item_id and user_side ('side_a' or 'side_b').");
  }

  const newsItem = await getNewsItem(news_item_id);

  const aiSide = OTHER_SIDE[user_side];

  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    messages: [

      {
        role: "system",

        content: `You are sparring with someone practicing debate. The story:

Headline: ${newsItem.headline}
What happened: ${newsItem.summary}
Background: ${newsItem.context}
The tension: ${newsItem.tension}

You are arguing this position, genuinely and well — not a strawman, the
strongest honest version of it:
"${sideText(newsItem, aiSide)}"

The user is about to argue the opposing position:
"${sideText(newsItem, user_side)}"

Open with a real, specific opening argument for your side — 2-4 sentences,
direct and substantive, no throat-clearing ("That's an interesting point,
but..."). Give them something real to push back against. Do not concede
anything yet; this is your opening, not a summary of both sides.`
      }

    ]

  });

  const opening = response.choices[0].message.content;

  const { data: session, error } = await supabase
    .from("practice_sessions")
    .insert([{
      type: "debate",
      news_item_id,
      user_side,
      transcript: [{ role: "assistant", message: opening }]
    }])
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("news_items")
    .update({ used_count: (newsItem.used_count || 0) + 1 })
    .eq("id", news_item_id);

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

  const newsItem = await getNewsItem(session.news_item_id);

  const aiSide = OTHER_SIDE[session.user_side];

  const transcript = [...session.transcript, { role: "user", message }];

  const history = transcript
    .map(t => `${t.role === "user" ? "User" : "You"}: ${t.message}`)
    .join("\n");

  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    messages: [

      {
        role: "system",

        content: `You are continuing a debate. The story:

Headline: ${newsItem.headline}
The tension: ${newsItem.tension}

You are arguing, genuinely and well:
"${sideText(newsItem, aiSide)}"

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

    model: "gpt-5.6-terra",

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
