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
  // The holdouts, recovered by following each careers URL until it admitted
  // what it runs on rather than by guessing slugs. Two of these matter most:
  // Rivian builds in Normal and State Farm is headquartered in Bloomington —
  // both a short drive from campus.
  { company: "Rivian", ats: "radancy", token: "careers.rivian.com", category: "local" },
  { company: "State Farm", ats: "radancy", token: "jobs.statefarm.com", category: "local" },
  { company: "United Airlines", ats: "phenom", token: "careers.united.com", category: "local" },
  { company: "Conagra Brands", ats: "phenom", token: "careers.conagrabrands.com", category: "local" },
  { company: "Northern Trust", ats: "workday", token: "ntrs/wd1/northerntrust", category: "local" },
  { company: "Discover / Capital One", ats: "workday", token: "capitalone/wd12/Capital_One", category: "local" },
  { company: "Nike", ats: "workday", token: "nike/wd1/nke", category: "brand" },

  // Round two of the watchlist, weighted to Illinois — Blake is at Illinois
  // State, and a summer within driving distance is this year's plan. Every
  // token below was probed live before it was written down.
  { company: "AbbVie", ats: "smartrecruiters", token: "abbvie", category: "local" },
  { company: "Abbott", ats: "workday", token: "abbott/wd5/abbottcareers", category: "local" },
  { company: "Allstate", ats: "workday", token: "allstate/wd5/allstate_careers", category: "local" },
  { company: "Beam Suntory", ats: "smartrecruiters", token: "beamsuntory", category: "brand" },
  { company: "Braze", ats: "greenhouse", token: "braze", category: "local" },
  { company: "CDW", ats: "workday", token: "cdw/wd5/Careers", category: "local" },
  { company: "Cameo", ats: "greenhouse", token: "cameo", category: "media" },
  { company: "Cars.com", ats: "workday", token: "cars/wd12/cars", category: "local" },
  { company: "Chewy", ats: "workday", token: "chewy/wd5/External", category: "brand" },
  { company: "Clorox", ats: "workday", token: "clorox/wd1/clorox", category: "brand" },
  { company: "Comscore", ats: "workday", token: "comscore/wd5/External", category: "media" },
  { company: "DraftKings", ats: "workday", token: "draftkings/wd1/draftkings", category: "media" },
  { company: "Enova", ats: "greenhouse", token: "enova", category: "local" },
  { company: "Fanatics", ats: "greenhouse", token: "fanaticsinc", category: "media" },
  { company: "Gap", ats: "smartrecruiters", token: "gapinc", category: "brand" },
  { company: "Genius Sports", ats: "greenhouse", token: "geniussports", category: "media" },
  { company: "Golin", ats: "greenhouse", token: "golin", category: "media" },
  { company: "Groupon", ats: "greenhouse", token: "groupon", category: "local" },
  { company: "Hasbro", ats: "greenhouse", token: "hasbro", category: "brand" },
  { company: "Highdive", ats: "greenhouse", token: "highdive", category: "media" },
  { company: "Huron", ats: "workday", token: "huron/wd1/huroncareers", category: "business" },
  { company: "Kimberly-Clark", ats: "smartrecruiters", token: "kimberlyclark", category: "brand" },
  { company: "Live Nation", ats: "smartrecruiters", token: "livenationentertainment", category: "media" },
  { company: "McDonalds", ats: "smartrecruiters", token: "mcdonaldscorporation", category: "local" },
  { company: "Mondelez", ats: "workday", token: "mdlz/wd3/External", category: "local" },
  { company: "Morningstar", ats: "workday", token: "morningstar/wd5/morningstar", category: "local" },
  { company: "Motorola Solutions", ats: "workday", token: "motorolasolutions/wd5/Careers", category: "local" },
  { company: "On Running", ats: "greenhouse", token: "onrunning", category: "brand" },
  { company: "Peacock / Sky", ats: "workday", token: "sky/wd3/sky_careers", category: "media" },
  { company: "Relativity", ats: "greenhouse", token: "relativity", category: "local" },
  { company: "Sportradar", ats: "smartrecruiters", token: "sportradar", category: "media" },
  { company: "Tempus", ats: "workday", token: "tempus/wd5/tempus_careers", category: "local" },
  { company: "The New York Times", ats: "greenhouse", token: "thenewyorktimes", category: "media" },
  { company: "Universal Music", ats: "smartrecruiters", token: "universalmusicgroup", category: "media" },
  { company: "VML", ats: "greenhouse", token: "wundermanthompson", category: "media" },
  { company: "Warner Music", ats: "lever", token: "wmg", category: "media" },
  { company: "Wayfair", ats: "smartrecruiters", token: "wayfair", category: "brand" },
  { company: "iHeartMedia", ats: "smartrecruiters", token: "iheartmedia", category: "media" },

  // Workday, where the biggest names live. `token` is "tenant/dc/site"; each
  // was probed live and returns a real board. These carry the roles most worth
  // catching — Disney, NBCU (through Comcast's tenant), Warner Bros Discovery.
  { company: "Disney", ats: "workday", token: "disney/wd5/disneycareer", category: "media" },
  { company: "NBCUniversal / Comcast", ats: "workday", token: "comcast/wd5/Comcast_Careers", category: "media" },
  { company: "Warner Bros Discovery", ats: "workday", token: "warnerbros/wd5/global", category: "media" },
  { company: "Target", ats: "workday", token: "target/wd5/targetcareers", category: "brand" },
  { company: "Salesforce", ats: "workday", token: "salesforce/wd12/External_Career_Site", category: "product" },
  { company: "Adobe", ats: "workday", token: "adobe/wd5/external_experienced", category: "product" },

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
