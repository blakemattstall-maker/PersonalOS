import { readFileSync } from "node:fs";
import supabase from "../web/lib/supabase.js";


// The watchlist, seeded once.
//
// Every entry was verified live before it landed here: each token was probed
// against its ATS and returned a real board with postings. Companies that hire
// through Workday or a bespoke careers site (Disney, NBCUniversal, Netflix,
// EA, Nike, Publicis, Dentsu, Havas, Edelman) have no public JSON endpoint and
// are deliberately absent rather than silently broken — better an honest gap
// than a source that reports zero forever.
//
// Weighted toward media and agencies on purpose: that is where Blake expects
// this particular summer to land, whatever the longer-term aim.
//
//   node scripts/seed-jobs.mjs
//
// Idempotent: re-running adds new rows and leaves existing ones alone.

const WATCHLIST = [
  { company: "Away", ats: "ashby", token: "away", category: "brand" },
  { company: "Glossier", ats: "greenhouse", token: "glossier", category: "brand" },
  { company: "Peloton", ats: "greenhouse", token: "peloton", category: "brand" },
  { company: "Sweetgreen", ats: "greenhouse", token: "sweetgreen", category: "brand" },
  { company: "Attentive", ats: "greenhouse", token: "attentive", category: "media" },
  { company: "Axios", ats: "greenhouse", token: "axios", category: "media" },
  { company: "BuzzFeed", ats: "greenhouse", token: "buzzfeed", category: "media" },
  { company: "Critical Mass", ats: "greenhouse", token: "criticalmass", category: "media" },
  { company: "Discord", ats: "greenhouse", token: "discord", category: "media" },
  { company: "Epic Games", ats: "greenhouse", token: "epicgames", category: "media" },
  { company: "GroupM", ats: "greenhouse", token: "wpp", category: "media" },
  { company: "Hearst", ats: "greenhouse", token: "hearst", category: "media" },
  { company: "Later", ats: "greenhouse", token: "later", category: "media" },
  { company: "Mediabrands", ats: "greenhouse", token: "mediabrands", category: "media" },
  { company: "Morning Brew", ats: "lever", token: "morningbrew", category: "media" },
  { company: "Ogilvy", ats: "greenhouse", token: "ogilvy", category: "media" },
  { company: "Omnicom", ats: "smartrecruiters", token: "omnicomgroup", category: "media" },
  { company: "Patreon", ats: "ashby", token: "patreon", category: "media" },
  { company: "R/GA", ats: "greenhouse", token: "rga", category: "media" },
  { company: "Riot Games", ats: "greenhouse", token: "riotgames", category: "media" },
  { company: "Roblox", ats: "greenhouse", token: "roblox", category: "media" },
  { company: "Spotify", ats: "lever", token: "spotify", category: "media" },
  { company: "Substack", ats: "ashby", token: "substack", category: "media" },
  { company: "Take Two", ats: "greenhouse", token: "taketwo", category: "media" },
  { company: "The Athletic", ats: "lever", token: "theathletic", category: "media" },
  { company: "Twitch", ats: "greenhouse", token: "twitch", category: "media" },
  { company: "Vayner Media", ats: "greenhouse", token: "vaynermedia", category: "media" },
  { company: "Vox Media", ats: "greenhouse", token: "voxmedia", category: "media" },
  { company: "Weber Shandwick", ats: "greenhouse", token: "webershandwick", category: "media" },
  { company: "Wieden Kennedy", ats: "greenhouse", token: "wk", category: "media" },
  { company: "Zeta Global", ats: "greenhouse", token: "zetaglobal", category: "media" },
  { company: "Airbnb", ats: "greenhouse", token: "airbnb", category: "product" },
  { company: "Airtable", ats: "greenhouse", token: "airtable", category: "product" },
  { company: "Anthropic", ats: "greenhouse", token: "anthropic", category: "product" },
  { company: "Asana", ats: "greenhouse", token: "asana", category: "product" },
  { company: "Brex", ats: "greenhouse", token: "brex", category: "product" },
  { company: "Cloudflare", ats: "greenhouse", token: "cloudflare", category: "product" },
  { company: "Coinbase", ats: "greenhouse", token: "coinbase", category: "product" },
  { company: "Databricks", ats: "greenhouse", token: "databricks", category: "product" },
  { company: "Datadog", ats: "greenhouse", token: "datadog", category: "product" },
  { company: "Duolingo", ats: "greenhouse", token: "duolingo", category: "product" },
  { company: "Figma", ats: "greenhouse", token: "figma", category: "product" },
  { company: "Hootsuite", ats: "greenhouse", token: "hootsuite", category: "product" },
  { company: "Instacart", ats: "greenhouse", token: "instacart", category: "product" },
  { company: "Klaviyo", ats: "greenhouse", token: "klaviyo", category: "product" },
  { company: "Linear", ats: "ashby", token: "linear", category: "product" },
  { company: "Lyft", ats: "greenhouse", token: "lyft", category: "product" },
  { company: "Notion", ats: "ashby", token: "notion", category: "product" },
  { company: "OpenAI", ats: "ashby", token: "openai", category: "product" },
  { company: "Pinterest", ats: "greenhouse", token: "pinterest", category: "product" },
  { company: "Plaid", ats: "ashby", token: "plaid", category: "product" },
  { company: "Ramp", ats: "ashby", token: "ramp", category: "product" },
  { company: "Reddit", ats: "greenhouse", token: "reddit", category: "product" },
  { company: "Robinhood", ats: "greenhouse", token: "robinhood", category: "product" },
  { company: "Scale AI", ats: "greenhouse", token: "scaleai", category: "product" },
  { company: "Sprout Social", ats: "greenhouse", token: "sproutsocial", category: "product" },
  { company: "Squarespace", ats: "greenhouse", token: "squarespace", category: "product" },
  { company: "Stripe", ats: "greenhouse", token: "stripe", category: "product" },
  { company: "Vercel", ats: "greenhouse", token: "vercel", category: "product" },];


const { data, error } = await supabase
  .from("job_sources")
  .upsert(WATCHLIST, { onConflict: "ats,token", ignoreDuplicates: true })
  .select();

if (error) {
  console.error("SEED FAILED:", error.message);
  process.exit(1);
}

const { count } = await supabase
  .from("job_sources")
  .select("id", { count: "exact", head: true });

console.log(`Watchlist: ${WATCHLIST.length} boards offered, ${count} now stored.`);
