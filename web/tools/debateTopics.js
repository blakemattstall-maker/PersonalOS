import openai from "../lib/openai.js";
import supabase from "../lib/supabase.js";
import { MODELS } from "../lib/models.js";
import { mapWithConcurrency } from "../lib/async.js";


// Evergreen debate topics — the standing disagreements, not the news.
//
// Debate used to run off the daily news digest, which meant the topics were
// whatever the wire feeds carried that morning: a Kashmir security crackdown,
// a Chinese property developer's balance sheet. Those are real and important
// and completely unarguable without doing research first, which put a reading
// assignment in front of the one feature meant to be low-friction.
//
// So the seed list below is deliberately made of questions any informed adult
// already has an opinion about and can defend cold. The test for inclusion is
// not "is this important" but "could he argue either side of this right now,
// with no preparation, using things he already knows".
//
// Two design rules, both load-bearing:
//
//   * Every entry is a genuine disagreement among thoughtful people, where the
//     losing side is not simply wrong. Topics with a real answer make terrible
//     sparring, because the model either has to argue badly in bad faith or
//     concede immediately.
//   * The framing is generated per topic and stored, not written by hand here.
//     Hand-writing "the two sides" of abortion in source code would be an
//     editorial act baked into the repo. Generating a good-faith framing at
//     least keeps it explicit, inspectable, and regenerable.

const SEED_TOPICS = [

  // Ethics / bodily autonomy / life
  { slug: "abortion-legality",        title: "Abortion",                                            category: "ethics",     difficulty: "common" },
  { slug: "assisted-dying",           title: "Physician-assisted dying",                            category: "ethics",     difficulty: "common" },
  { slug: "death-penalty",            title: "The death penalty",                                   category: "ethics",     difficulty: "common" },
  { slug: "animal-farming",           title: "Whether eating factory-farmed meat is defensible",    category: "ethics",     difficulty: "common" },

  // Economics / inequality
  { slug: "billionaires-should-exist", title: "Whether billionaires should exist",                  category: "economics",  difficulty: "common" },
  { slug: "universal-basic-income",   title: "Universal basic income",                              category: "economics",  difficulty: "common" },
  { slug: "minimum-wage",             title: "Raising the minimum wage",                            category: "economics",  difficulty: "common" },
  { slug: "student-debt-forgiveness", title: "Student debt forgiveness",                            category: "economics",  difficulty: "common" },
  { slug: "inheritance-tax",          title: "Taxing inherited wealth heavily",                     category: "economics",  difficulty: "common" },
  { slug: "college-worth-it",         title: "Whether a four-year degree is still worth the money", category: "economics",  difficulty: "common" },

  // Religion / meaning
  { slug: "religion-net-good",        title: "Whether religion has been a net good for humanity",   category: "religion",   difficulty: "common" },
  { slug: "religious-exemptions",     title: "Religious exemptions from generally applicable laws", category: "religion",   difficulty: "common" },
  { slug: "faith-schools",            title: "Public funding for religious schools",                category: "religion",   difficulty: "common" },

  // Speech / politics / institutions
  { slug: "free-speech-limits",       title: "Whether hate speech should be legally protected",     category: "politics",   difficulty: "common" },
  { slug: "social-media-moderation",  title: "Who should decide what gets removed from social media", category: "politics", difficulty: "common" },
  { slug: "voting-age",               title: "Lowering the voting age to 16",                       category: "politics",   difficulty: "common" },
  { slug: "electoral-college",        title: "Abolishing the Electoral College",                    category: "politics",   difficulty: "common" },
  { slug: "term-limits",              title: "Term limits for Congress",                            category: "politics",   difficulty: "common" },

  // Technology
  { slug: "ai-job-displacement",      title: "Whether AI displacing jobs should be slowed down",    category: "technology", difficulty: "common" },
  { slug: "ai-art-training",          title: "Training AI on artists' work without permission",     category: "technology", difficulty: "common" },
  { slug: "phones-in-schools",        title: "Banning phones in schools",                           category: "technology", difficulty: "common" },
  { slug: "genetic-editing",          title: "Editing human embryos to prevent disease",            category: "technology", difficulty: "common" },

  // Society
  { slug: "drug-decriminalization",   title: "Decriminalizing hard drugs",                          category: "society",    difficulty: "common" },
  { slug: "prison-purpose",           title: "Whether prison should punish or rehabilitate",        category: "society",    difficulty: "common" },
  { slug: "affirmative-action",       title: "Race-conscious college admissions",                   category: "society",    difficulty: "common" },
  { slug: "parents-screen-time",      title: "Whether parents owe kids a childhood without smartphones", category: "society", difficulty: "common" },
  { slug: "mandatory-service",        title: "Mandatory national service",                          category: "society",    difficulty: "common" },
  { slug: "cancel-culture",           title: "Whether public shaming is an appropriate accountability tool", category: "society", difficulty: "common" }

];


function missingTable(error) {
  return error?.code === "PGRST205" || /schema cache/i.test(error?.message || "");
}


async function frame(seed) {

  const response = await openai.chat.completions.create({

    model: MODELS.JUDGMENT,

    response_format: { type: "json_object" },

    messages: [

      {
        role: "system",

        content: `Frame a debate topic for someone practicing argument. The
topic: "${seed.title}".

He will pick a side and spar against you. So both sides must be genuinely
defensible by a thoughtful, decent person — if you write one side as obviously
correct, the exercise is worthless.

You are NOT arguing here and you are NOT signalling which side you find more
persuasive. You are setting up a fair fight.

Produce:
1. context — the background needed to argue this honestly: what the real
   disagreement is actually about, what's usually conflated with it, and the
   distinction that matters most. 3-4 sentences. No "this is a complex issue".
2. tension — the specific question at stake, phrased so that BOTH answers are
   defensible. Not "is X good or bad" but the real crux people divide on.
3. side_a and side_b — the strongest, most honest version of each position, as
   its most intelligent advocate would put it. Each 2-3 sentences. Steelman
   both. Never a caricature, never a position stated so it's easy to knock over.

Critically: pick the crux that thoughtful people actually disagree on, not the
loud public version. The strongest arguments on each side of most of these are
not the ones you hear on television.

Return ONLY JSON:
{ "context": "...", "tension": "...", "side_a": "...", "side_b": "..." }`
      }

    ]

  });

  return JSON.parse(response.choices[0].message.content);

}


// Tops up whatever isn't framed yet. Idempotent by slug, so a partial run
// (function timeout, API blip) is fixed by simply running it again — no
// duplicate rows, no need to work out what got through.
export async function ensureTopicsFramed({ limit = 8 } = {}) {

  const { data: existing, error } = await supabase
    .from("debate_topics")
    .select("slug");

  if (error) {

    if (missingTable(error)) {
      return {
        success: false,
        needsMigration: "docs/schema-practice-split.sql",
        message: "The debate_topics table doesn't exist yet — run docs/schema-practice-split.sql in Supabase."
      };
    }

    throw new Error(error.message);

  }

  const have = new Set((existing || []).map(r => r.slug));

  const todo = SEED_TOPICS.filter(s => !have.has(s.slug)).slice(0, limit);

  if (todo.length === 0) {
    return { success: true, framed: 0, message: "Every seed topic is already framed.", total: have.size };
  }

  const errors = [];

  // Each framing is an independent model call; serialising them made a full
  // first run take long enough to hit the function timeout.
  const rows = await mapWithConcurrency(todo, async seed => {

    try {

      const framed = await frame(seed);

      return {
        slug: seed.slug,
        title: seed.title,
        category: seed.category,
        difficulty: seed.difficulty,
        context: framed.context,
        tension: framed.tension,
        side_a: framed.side_a,
        side_b: framed.side_b
      };

    } catch (err) {
      errors.push({ slug: seed.slug, error: err.message });
      return null;
    }

  }, 3);

  const usable = rows.filter(Boolean);

  if (usable.length === 0) {
    return { success: false, framed: 0, errors, message: "Couldn't frame any topics." };
  }

  // Ignore duplicates from a concurrent run rather than failing the batch.
  const { error: insertError } = await supabase
    .from("debate_topics")
    .upsert(usable, { onConflict: "slug", ignoreDuplicates: true });

  if (insertError) throw new Error(insertError.message);

  return {
    success: true,
    framed: usable.length,
    errors,
    message: `Framed ${usable.length} new debate topic${usable.length === 1 ? "" : "s"}.`,
    remaining: SEED_TOPICS.length - have.size - usable.length
  };

}


// Least-argued first, so working through the list doesn't mean seeing the same
// four topics every time the page loads.
export async function getDebateTopics({ limit = 6 } = {}) {

  const { data, error } = await supabase
    .from("debate_topics")
    .select("*")
    .eq("retired", false)
    .order("used_count", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (missingTable(error)) return [];
    throw new Error(error.message);
  }

  return data || [];

}


// "Not this one." Unlike a news story, a topic is worth keeping around —
// retiring hides it from the deck without destroying the sessions recorded
// against it or letting the seed list re-create it on the next top-up.
export async function retireDebateTopic(id) {

  if (!id) throw new Error("retireDebateTopic requires an id.");

  const { error } = await supabase
    .from("debate_topics")
    .update({ retired: true })
    .eq("id", id);

  if (error) throw new Error(error.message);

  return { success: true };

}


export const SEED_COUNT = SEED_TOPICS.length;
