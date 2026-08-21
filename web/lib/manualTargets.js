// The places no poller can reach.
//
// Two kinds of company end up here, and the distinction matters because the
// approach differs:
//
//   "blocked"  — big enough to have a real careers system, and defended by bot
//                protection that returns an empty body to anything without a
//                browser. Apple, Microsoft, Google, Meta. Nothing to build;
//                these need a human with a browser at the right time of year.
//
//   "small"    — a studio of ten to forty people with no applicant tracking
//                system at all. There is no feed because there is no software:
//                they post on their own site, or they hire whoever wrote them a
//                good email. For these the move is not to watch, it is to
//                reach out. That is an advantage, not a consolation — a
//                thoughtful email to a forty-person Chicago studio lands in a
//                human's inbox, where the same effort at Amazon is one of
//                eleven thousand applications.
//
// Every URL here was checked live. Several corrected real drift: OKRP is now
// Barkley OKRP, FCB Chicago's site resolves to BBDO Chicago, and Firebelly and
// Burrell have no /careers path at all.

export const MANUAL_TARGETS = [

  // ── The giants, by hand and by season ────────────────────────────────────
  {
    slug: "microsoft",
    name: "Microsoft",
    group: "The giants (no public feed)",
    kind: "blocked",
    url: "https://jobs.careers.microsoft.com/global/en/search?q=intern",
    note: "Opens mid-August — already live for Summer 2027. Check first."
  },
  {
    slug: "google",
    name: "Google — incl. BOLD",
    group: "The giants (no public feed)",
    kind: "blocked",
    url: "https://www.google.com/about/careers/applications/jobs/results/?employment_type=INTERN",
    note: "BOLD is the business/marketing programme and is built for underclassmen — late September. Main window mid-October, closes in 2–4 weeks."
  },
  {
    slug: "apple",
    name: "Apple",
    group: "The giants (no public feed)",
    kind: "blocked",
    url: "https://jobs.apple.com/en-us/search?search=intern",
    note: "Rolling, September through November. Roles appear and fill without announcement, so weekly is the cadence."
  },
  {
    slug: "meta",
    name: "Meta",
    group: "The giants (no public feed)",
    kind: "blocked",
    url: "https://www.metacareers.com/jobs",
    note: "September into October."
  },

  // ── Networks whose Chicago shops hire through a parent system ────────────
  {
    slug: "leo-burnett",
    name: "Leo Burnett",
    group: "Chicago agencies (parent systems)",
    kind: "blocked",
    url: "https://leoburnett.com/",
    note: "Publicis parent system — no public board. Chicago's biggest agency name."
  },
  {
    slug: "bbdo-chicago",
    name: "BBDO Chicago (formerly Energy BBDO)",
    group: "Chicago agencies (parent systems)",
    kind: "blocked",
    url: "https://bbdochi.com/",
    note: "Omnicom parent. The Omnicom board is already polled, but Chicago roles do not always reach it."
  },
  {
    slug: "ddb",
    name: "DDB",
    group: "Chicago agencies (parent systems)",
    kind: "blocked",
    url: "https://www.ddb.com/careers",
    note: "Omnicom network — Chicago office hires separately from the parent board this app already polls."
  },
  {
    slug: "digitas",
    name: "Digitas",
    group: "Chicago agencies (parent systems)",
    kind: "blocked",
    url: "https://www.digitas.com/en-us/careers",
    note: "Publicis network. Strong for digital and CRM work, which is close to what he already does."
  },
  {
    slug: "havas-chicago",
    name: "Havas Chicago",
    group: "Chicago agencies (parent systems)",
    kind: "blocked",
    url: "https://www.havas.com/",
    note: "Havas parent system — the Chicago office posts through it inconsistently, so check the office site too."
  },
  {
    slug: "burrell",
    name: "Burrell Communications",
    group: "Chicago agencies (parent systems)",
    kind: "small",
    url: "https://www.burrell.com/",
    note: "Chicago-founded, independent. No careers path on the site — email."
  },

  // ── Independent Chicago shops: email, do not wait ────────────────────────
  {
    slug: "vsa-partners",
    name: "VSA Partners",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://www.vsapartners.com/careers",
    note: "Design-led, works with big brands. Has a careers page — rare for this size."
  },
  {
    slug: "ia-collaborative",
    name: "IA Collaborative",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://iacollaborative.com/careers",
    note: "Design and innovation consultancy."
  },
  {
    slug: "barkley-okrp",
    name: "Barkley OKRP",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://barkleyokrp.com/",
    note: "Was O'Keefe Reinhard & Paul; merged with Barkley. One of the strongest independent creative shops in the city."
  },
  {
    slug: "cramer-krasselt",
    name: "Cramer-Krasselt",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://www.c-k.com/careers",
    note: "Large independent — one of the few with a real careers page."
  },
  {
    slug: "50000feet",
    name: "50,000feet",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://50000feet.com/careers",
    note: "Brand and design studio."
  },
  {
    slug: "upshot",
    name: "Upshot",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://www.upshotagency.com/careers",
    note: "Brand engagement agency."
  },
  {
    slug: "escape-pod",
    name: "The Escape Pod",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://theescapepod.com/contact",
    note: "Small creative shop. Contact form only — that IS the application."
  },
  {
    slug: "firebelly",
    name: "Firebelly Design",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://firebellydesign.com/",
    note: "Small, mission-driven studio. No careers page — email is the only door."
  },
  {
    slug: "thirst",
    name: "Thirst",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://thirstdc.com/",
    note: "Design studio, Rick Valicenti. Tiny and well-regarded."
  },
  {
    slug: "rule29",
    name: "Rule29",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://www.rule29.com/",
    note: "Geneva, IL — creative firm."
  },
  {
    slug: "grip-design",
    name: "GRIP Design",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://gripdesign.com/",
    note: "Chicago brand and product design."
  },
  {
    slug: "optimus",
    name: "Optimus",
    group: "Chicago independents — write to them",
    kind: "small",
    url: "https://www.optimus.com/",
    note: "Chicago production and post house — the film/production side."
  },

  // ── Platforms worth a weekly pass ────────────────────────────────────────
  {
    slug: "handshake",
    name: "Handshake (ISU)",
    group: "Platforms — check weekly",
    kind: "blocked",
    url: "https://joinhandshake.com/",
    note: "Needs your login, so it cannot be automated. Worth the most per minute of anything on this page: employers filter by school and year, so postings have a fraction of the applicants and many are explicitly open to underclassmen."
  },
  {
    slug: "teamwork-online",
    name: "TeamWork Online",
    group: "Platforms — check weekly",
    kind: "blocked",
    url: "https://www.teamworkonline.com/jobs",
    note: "Where nearly every pro sports team posts — Bulls, Cubs, Bears, Blackhawks, Fire, White Sox. None of them use a normal ATS."
  }

];


export const MANUAL_GROUPS = [...new Set(MANUAL_TARGETS.map(t => t.group))];


// Two weeks without a look is the point at which a season can pass you by.
export const STALE_AFTER_DAYS = 14;


export function isStale(checkedAt, now = Date.now()) {
  if (!checkedAt) return true;
  return now - new Date(checkedAt).getTime() > STALE_AFTER_DAYS * 86400000;
}
