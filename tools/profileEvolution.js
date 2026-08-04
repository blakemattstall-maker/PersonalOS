import openai from "../lib/openai.js";
import { getProfile, clearProfileCache } from "../lib/profile.js";
import { getMemories } from "./memory.js";
import { logActivity } from "./activityLog.js";
import supabase from "../lib/supabase.js";


// The bio is the single richest thing the system knows about the user, and it
// was a static block written once by hand — while memories kept accumulating
// beside it, never folding back in. This rewrites the bio from the bio plus
// everything learned since.
//
// Rewriting the user's own self-description is the most destructive thing in
// this codebase, so: the previous version is written to activity_logs first
// (nothing else records it, and there's no updated_at on profiles to recover
// from), and the prompt is heavily biased toward preserving what's already
// there rather than producing a tidier summary.
export async function regenerateBio() {

  const [profile, memories] = await Promise.all([
    getProfile(),
    getMemories(100)
  ]);


  if (!profile?.bio) {
    return { success: true, skipped: "no existing bio to evolve" };
  }

  if (!memories || memories.length === 0) {
    return { success: true, skipped: "no memories to fold in" };
  }


  const formatted = memories
    .map(m => `- [${m.type}] ${m.content}`)
    .join("\n");


  const response = await openai.chat.completions.create({

    model: "gpt-5.6-terra",

    messages: [

      {
        role: "system",

        content: `You maintain the profile of the user this assistant serves.

Their current profile:
${profile.bio}

Everything the system has learned about them since, newest first:
${formatted}

Produce an updated profile.

RULES — the first is the most important:
- Never lose a concrete fact. Every name, number, date, place, institution,
  relationship and commitment in the current profile must survive verbatim
  unless a memory directly contradicts it, in which case take the memory and
  keep the change visible.
- Only add things genuinely supported by the memories above. Invent nothing,
  and do not infer personality from thin evidence.
- Memories are often coarser than the profile. Where one restates something
  the profile already covers in more detail, keep the profile's version and
  add nothing — do not append the vaguer phrasing alongside it. A memory
  saying "lives in Chicago" next to a profile that already gives their term
  address, home address and move date adds nothing and reads as a
  contradiction. Only fold a memory in when it says something genuinely new
  or genuinely conflicting.
- Do not editorialise, summarise for brevity, or make it read more nicely.
  Density beats polish. It is better to be long than to drop a detail.
- Same voice and third-person style as the current profile.

Return the profile text only — no preamble, no headings, no commentary.`
      }

    ]

  });


  const updated = response.choices[0].message.content?.trim();


  // A short or empty rewrite means something went wrong; keeping the old bio
  // is always safer than replacing it with something thinner.
  if (!updated || updated.length < profile.bio.length * 0.6) {

    return {
      success: false,
      skipped: `rewrite looked lossy (${updated?.length || 0} chars vs ${profile.bio.length}), kept the original`
    };

  }


  await logActivity({
    action: "bio_snapshot_before_regeneration",
    input: profile.bio,
    output: { note: "previous bio, kept so a bad rewrite can be restored" },
    success: true,
    source: "cron"
  });


  const { error } = await supabase
    .from("profiles")
    .update({ bio: updated })
    .eq("id", profile.id);


  if (error) {
    throw new Error(error.message);
  }


  clearProfileCache();


  return {
    success: true,
    message: `Profile updated from ${memories.length} memories (${profile.bio.length} -> ${updated.length} chars).`,
    data: { previousLength: profile.bio.length, newLength: updated.length, memoriesUsed: memories.length }
  };

}
