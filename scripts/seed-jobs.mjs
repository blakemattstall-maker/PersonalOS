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
  // Round four: more Chicago, plus a community dataset that reaches the
  // giants whose own APIs refuse anything without a browser.
  { company: "Alight", ats: "smartrecruiters", token: "alight", category: "local" },
  { company: "Amount", ats: "greenhouse", token: "amount", category: "local" },
  { company: "BMO", ats: "workday", token: "bmo/wd3/External", category: "local" },
  { company: "Belvedere", ats: "lever", token: "belvederetrading", category: "local" },
  { company: "Beyond Finance", ats: "greenhouse", token: "beyondfinance", category: "local" },
  { company: "Blue Owl", ats: "workday", token: "blueowl/wd1/blueowl", category: "local" },
  { company: "ComEd", ats: "radancy", token: "careers.comed.com", category: "local" },
  { company: "Cresco Labs", ats: "greenhouse", token: "crescolabs", category: "local" },
  { company: "Echo Global", ats: "greenhouse", token: "echo", category: "local" },
  { company: "HCSC", ats: "workday", token: "hcsc/wd1/hcsc_External", category: "local" },
  { company: "JLL", ats: "workday", token: "jll/wd1/jllcareers", category: "local" },
  { company: "Jump Trading", ats: "greenhouse", token: "jumptrading", category: "local" },
  { company: "M1 Finance", ats: "smartrecruiters", token: "m1finance", category: "local" },
  { company: "Northwestern Mutual", ats: "smartrecruiters", token: "northwesternmutual", category: "local" },
  { company: "Simplify (Product, S27)", ats: "simplify", token: "summer2027", category: "product" },
  { company: "SpotHero", ats: "greenhouse", token: "spothero", category: "local" },
  { company: "Sysco", ats: "workday", token: "sysco/wd5/syscocareers", category: "local" },
  { company: "Tovala", ats: "lever", token: "tovala", category: "local" },
  { company: "TransUnion", ats: "workday", token: "transunion/wd5/transunion", category: "local" },
  { company: "US Foods", ats: "phenom", token: "careers.usfoods.com", category: "local" },
  { company: "VSA Partners", ats: "greenhouse", token: "vsapartners", category: "media" },

  // Round three: the moonshots, the studios, the boutique Chicago shops and
  // the sports/production names. Every token probed live before landing here.
  { company: "A24", ats: "greenhouse", token: "a24", category: "media" },
  { company: "ActiveCampaign", ats: "lever", token: "activecampaign", category: "local" },
  { company: "Amazon", ats: "amazon", token: "amazon", category: "product" },
  { company: "Aon", ats: "radancy", token: "jobs.aon.com", category: "local" },
  { company: "Blizzard", ats: "phenom", token: "careers.blizzard.com", category: "media" },
  { company: "Block", ats: "greenhouse", token: "block", category: "product" },
  { company: "Bombas", ats: "greenhouse", token: "bombas", category: "media" },
  { company: "Booking", ats: "radancy", token: "jobs.booking.com", category: "product" },
  { company: "Bungie", ats: "greenhouse", token: "bungie", category: "media" },
  { company: "Cisco", ats: "workday", token: "cisco/wd5/cisco_careers", category: "product" },
  { company: "Crunchyroll", ats: "greenhouse", token: "crunchyroll", category: "media" },
  { company: "Dropbox", ats: "greenhouse", token: "dropbox", category: "product" },
  { company: "Etsy", ats: "workday", token: "etsy/wd5/etsy_careers", category: "product" },
  { company: "G2", ats: "ashby", token: "g2", category: "local" },
  { company: "Gearbox", ats: "greenhouse", token: "gearbox", category: "media" },
  { company: "ITW", ats: "phenom", token: "careers.itw.com", category: "local" },
  { company: "Illumination", ats: "lever", token: "illumination", category: "media" },
  { company: "Intel", ats: "workday", token: "intel/wd1/External", category: "product" },
  { company: "Jam City", ats: "lever", token: "jamcity", category: "media" },
  { company: "Jellyfish", ats: "ashby", token: "jellyfish", category: "media" },
  { company: "Kin Insurance", ats: "ashby", token: "kin", category: "local" },
  { company: "Krafton", ats: "greenhouse", token: "krafton", category: "media" },
  { company: "Learfield", ats: "workday", token: "learfield/wd5/learfield", category: "media" },
  { company: "LinkedIn", ats: "greenhouse", token: "linkedin", category: "product" },
  { company: "Liquid Death", ats: "greenhouse", token: "liquiddeath", category: "media" },
  { company: "Litera", ats: "workday", token: "litera/wd12/litera_careers", category: "local" },
  { company: "Lucid", ats: "greenhouse", token: "lucidmotors", category: "local" },
  { company: "NBA", ats: "phenom", token: "careers.nba.com", category: "media" },
  { company: "NVIDIA", ats: "workday", token: "nvidia/wd5/NVIDIAExternalCareerSite", category: "product" },
  { company: "Navistar", ats: "radancy", token: "careers.navistar.com", category: "local" },
  { company: "Neon", ats: "lever", token: "neon", category: "media" },
  { company: "New Balance", ats: "workday", token: "newbalance/wd1/Careers", category: "media" },
  { company: "Octagon", ats: "greenhouse", token: "octagon", category: "media" },
  { company: "Okta", ats: "greenhouse", token: "okta", category: "product" },
  { company: "Olipop", ats: "greenhouse", token: "olipop", category: "media" },
  { company: "Polaris", ats: "greenhouse", token: "polaris", category: "local" },
  { company: "Project44", ats: "greenhouse", token: "project44", category: "local" },
  { company: "Schafer Condon Carter", ats: "smartrecruiters", token: "schafercondoncarter", category: "media" },
  { company: "Scopely", ats: "greenhouse", token: "scopely", category: "media" },
  { company: "ServiceNow", ats: "smartrecruiters", token: "servicenow", category: "product" },
  { company: "Skydance", ats: "lever", token: "skydance", category: "media" },
  { company: "Snowflake", ats: "ashby", token: "snowflake", category: "product" },
  { company: "Starz", ats: "workday", token: "starz/wd5/starz", category: "media" },
  { company: "Teamworks", ats: "ashby", token: "teamworks", category: "media" },
  { company: "TripAdvisor", ats: "greenhouse", token: "tripadvisor", category: "product" },
  { company: "Twilio", ats: "greenhouse", token: "twilio", category: "product" },
  { company: "Uber", ats: "smartrecruiters", token: "uber", category: "product" },
  { company: "Vuori", ats: "greenhouse", token: "vuori", category: "media" },
  { company: "Workday", ats: "workday", token: "workday/wd5/workday", category: "product" },
  { company: "Xsolla", ats: "lever", token: "xsolla", category: "media" },
  { company: "Zeno Group", ats: "ashby", token: "zeno", category: "media" },
  { company: "Zoom", ats: "workday", token: "zoom/wd5/zoom", category: "product" },

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
