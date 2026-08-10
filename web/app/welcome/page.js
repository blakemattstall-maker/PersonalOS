import Link from "next/link";

import Hero from "./Hero.js";
import { Section, Detail, Mono, Stage } from "./parts.js";
import SceneCapture from "./SceneCapture.js";
import SceneGraph from "./SceneGraph.js";
import SceneBrief from "./SceneBrief.js";
import SceneNudge from "./SceneNudge.js";
import SceneMoney from "./SceneMoney.js";


// The signed-out door.
//
// This page reads nothing and is prerendered at build time, which is not an
// optimisation detail. It is the only route outside the session check, so it
// must not be able to reach the database, a connected account or a calendar
// even by accident. There is no data-fetching call anywhere below; every figure
// on this page is invented, written into the source, and labelled as a sample.
export const metadata = {
  title: "Almanac",
  description:
    "A personal operating system. Capture a sentence anywhere, and it is parsed, dated, filed and connected to everything already on record, then read back to you each morning as a short briefing.",
  openGraph: {
    title: "Almanac",
    description:
      "Capture a sentence anywhere. It gets parsed, dated, filed and connected to everything already on record, then read back each morning as a short briefing.",
    type: "website",
    // Explicit, because defining openGraph here shadows the root layout's — and
    // the root URL redirects a signed-out visitor (every link scraper) HERE, so
    // this is the page whose card LinkedIn actually renders. Resolves against
    // metadataBase to the real domain.
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Almanac" }]
  }
};


const DETECTORS = [
  {
    name: "relationship_debt",
    plain: "A contact you set a check-in cadence for has gone quiet, and you are about to see them anyway.",
    found: "19 days since last contact against a 14 day cadence, with a meeting on Thursday."
  },
  {
    name: "contradiction",
    plain: "Two things recorded at different times cannot both still be true.",
    found: "A stated finish date in March and a dependency that does not land until June."
  },
  {
    name: "project_cost",
    plain: "Real money has gone into something not being tracked as an expense.",
    found: "A $146.80 charge matched to a project with no recorded budget."
  },
  {
    name: "concentration",
    plain: "One thing is quietly taking a disproportionate share of your time or your spending.",
    found: "Four of the last six evening blocks went to the same stalled project."
  }
];


// Described by technique rather than by vendor. Anyone who works on this kind
// of system will recognise every line; nobody gets a shopping list.
const STACK = [
  [
    "Application",
    "Server-rendered React on managed edge infrastructure. Every route streams behind its own suspense boundary, so navigation swaps instantly and content fills in rather than the page hanging on a slow upstream call."
  ],
  [
    "Store",
    "Postgres. Each domain keeps its own table, with a single link table holding typed, directional edges between them under a natural-key upsert, so re-running extraction over the same text is idempotent rather than duplicative."
  ],
  [
    "Capture",
    "A phone shortcut posts text or a voice recording from anywhere, including the lock screen, with no app to open. Audio is transcribed, classified, and routed to whichever handler matches, and relative dates are resolved before anything is written."
  ],
  [
    "Passive inputs",
    "Calendar and task events, mail headers and snippets, transactions from connected accounts, and coarse location. Read scopes only; nothing is sent on your behalf without an explicit action."
  ],
  [
    "Delivery",
    "Web Push over VAPID, straight to the lock screen, with no native app and no third-party notification service in the path. Every message deep-links to the record it is about."
  ],
  [
    "Models",
    "Tiered by job. A small, fast model classifies and routes; a stronger one is reserved for synthesis and judgement. Neither is ever asked to compute a figure that appears on screen."
  ]
];


export default function Welcome() {

  return (
    <div className="bg-paper">

      <Hero />

      <Section
        id="capture"
        eyebrow="01 · Capture"
        tone="ember"
        title="Say it once and it files itself."
        lede="One sentence, typed or spoken, gets parsed into the right kind of record, given a real date, written to your calendar, task list or notes, and attached to anything it mentions. There is no form to fill in and no category to choose."
        tech={
          <>
            <p>
              Capture runs through a phone shortcut, so a thought can be recorded
              from the lock screen without opening anything. It accepts typed
              text or a voice recording, transcribes the audio, and posts it to a
              single endpoint. A first pass classifies what kind of thing was
              said; a second extracts the fields for that kind.
            </p>
            <p>
              Relative dates are resolved <em>at the moment of capture</em> and
              stored as absolute dates. This is the difference between a system
              that works and one that quietly lies to you: store the phrase
              instead, and something reading it back four days later has no idea
              when it was written and will repeat the word &ldquo;tomorrow&rdquo;
              about a deadline that has already passed.
            </p>
            <p>
              A deduplication pass sits in front of the write, so saying the same
              thing twice in a week produces one record plus a note that it has
              now been said twice, which is itself worth knowing.
            </p>
          </>
        }
      >
        <SceneCapture />
      </Section>

      <Section
        id="graph"
        eyebrow="02 · Connections"
        tone="tide"
        title="Every record knows what it relates to."
        lede="Most tools keep tidy separate lists: contacts in one place, spending in another, notes somewhere else. The useful information lives between them. That a charge paid for a specific project, that an evening belongs to a specific person, that one workspace is where two different things actually get done."
        tech={
          <>
            <p>
              Edges live in a single table keyed on
              <Mono>(from_type, from_id, to_type, to_id, relation)</Mono> and
              written with an upsert, so extraction can be re-run over the same
              text as often as you like without multiplying the graph.
            </p>
            <p>
              Extraction matches text against records that already exist, on
              whole-word boundaries, and never on a model&apos;s impression that
              two things feel related. Names under three characters are ignored
              outright, because the false-positive rate on those swamps anything
              they find. A wrong edge is worse than a missing one, since
              everything downstream treats edges as fact.
            </p>
            <p>
              Lookups return both directions and preserve which is which.
              &ldquo;This note mentions a contact&rdquo; and &ldquo;this contact
              is mentioned by a note&rdquo; are the same edge but not the same
              sentence, and a briefing that confuses them reads as nonsense.
            </p>
          </>
        }
      >
        <SceneGraph />
      </Section>

      <Section
        id="insights"
        eyebrow="03 · Patterns"
        tone="iris"
        title="It reads across your data and tells you what it finds."
        lede="A set of detectors walks the connections on a schedule, looking for specific shapes that mean something. When a shape is not there, they say nothing, which is most days. What you can ask it is only half the picture — this is the half where it comes to you first."
        tech={
          <>
            <p>
              Each detector is an ordinary function over the graph rather than a
              prompt. It either matches a shape or it does not, so any finding
              can be traced back to the exact records that produced it, and the
              same input always produces the same output.
            </p>
            <p>
              A model is involved only at the final step, to phrase a finding
              that has already been established as true. Findings are then
              deduplicated against what has recently been delivered and passed
              through the same interruption budget as everything else. A pattern
              being interesting does not exempt it from being an interruption.
            </p>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {DETECTORS.map(d => (
            <div key={d.name} className="rounded-card border border-[var(--line)] bg-card p-4 shadow-lift">
              <p className="pos-data text-[0.72rem] text-moss">{d.name}</p>
              <p className="mt-2 text-[0.88rem] leading-snug text-ink">{d.plain}</p>
              <p className="mt-3 border-t border-[var(--line)] pt-3 text-[0.8rem] leading-relaxed text-ink-soft">
                {d.found}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-[0.88rem] leading-relaxed text-ink-soft">
          When one of these actually clears the bar, it is delivered as a real
          push notification to the phone&apos;s lock screen, not just something
          waiting the next time the app happens to be opened.
        </p>
      </Section>

      <Section
        id="brief"
        eyebrow="04 · Daily briefing"
        tone="ember"
        title="A short briefing each morning that has done the reading for you."
        lede="Not a list of your events read back to you. Every figure is calculated before a model sees anything, and the model is asked only to decide what actually matters today and say it in three short paragraphs."
        tech={
          <>
            <p>
              Calendar, tasks, contacts, projects, open intentions, mail and
              cross-domain signals are gathered in parallel. Each source settles
              independently, so one slow upstream call degrades a single line
              rather than blanking the whole briefing.
            </p>
            <p>
              Event kinds are classified in code as well. A meeting with other
              people, an appointment, an hour set aside for yourself and a bare
              reminder are not the same thing and must not be described as if
              they were. Overlaps are detected before the prompt is built, so the
              model states a collision as fact rather than trying to spot one.
            </p>
            <p>
              The instruction is explicit: do no arithmetic. A model that does
              its own arithmetic will occasionally be wrong and will always sound
              certain, and a briefing you have to double-check is worth less than
              no briefing at all.
            </p>
          </>
        }
      >
        <SceneBrief />
      </Section>

      <Section
        id="nudges"
        eyebrow="05 · Interruptions"
        tone="moss"
        title="It only reaches you when something genuinely needs an answer."
        lede="Anything that can reach your lock screen has to earn it every time. Candidates are generated freely, and most of the work goes into throwing them away."
        tech={
          <>
            <p>
              Hard limits rather than heuristics: at most two messages per run,
              and never two about the same intention inside three days.
              Candidates are batched and deduplicated before anything is sent,
              which is what prevents the obvious failure mode of three
              notifications about one deadline arriving before breakfast.
            </p>
            <p>
              Every kind of message declares a minimum urgency tier, and those
              tiers are matched against your notification setting through a
              shared table rather than compared as free-form strings. Two
              vocabularies drifting apart is exactly how a system ends up
              silently delivering nothing while reporting that it is set to
              deliver everything.
            </p>
            <p>
              Delivery windows are set per kind. A check-in about a person goes
              out in the morning; a reminder about an evening block goes out in
              the late afternoon. Nothing is queued overnight, because a
              notification read at seven in the morning in a stack of six is a
              notification you dismiss.
            </p>
          </>
        }
      >
        <SceneNudge />
      </Section>

      <Section
        id="money"
        eyebrow="06 · Spending"
        tone="tide"
        title="Spending sorted into real categories, without tagging anything."
        lede="Bank feeds arrive as a merchant string and an amount, with no category attached to them. Every transaction here is classified on arrival, ranked by size, and checked for the charges that repeat."
        tech={
          <>
            <p>
              Classification is rule-first and model-second. A merchant is
              matched against an ordered rule list, and only an unrecognised one
              is escalated to a model, whose answer is then cached so the same
              merchant is never paid for twice. Rule order carries real meaning:
              fuel has to be tested before groceries, or a supermarket-branded
              petrol station gets filed as food.
            </p>
            <p>
              Repeating charges are found structurally, by looking for the same
              merchant at roughly the same amount more than once, rather than by
              matching against a list of known subscription names. A list only
              ever finds the services someone thought to add to it.
            </p>
            <p>
              Account data is pulled on a fixed schedule, cached, and then sliced
              locally for whatever window the page asks for. Every figure on the
              page is computed server-side, and no model produced any number on
              it.
            </p>
          </>
        }
      >
        <SceneMoney />
      </Section>

      <Section
        id="stack"
        eyebrow="07 · How it is built"
        tone="iris"
        title="The parts that make the rest of it possible."
        lede="Described by technique rather than by product name. Everything listed here runs today."
      >
        <Stage minH="min-h-0">
          <dl className="divide-y divide-[var(--line)]">
            {STACK.map(([term, detail]) => (
              <div key={term} className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-6">
                <dt className="pos-data shrink-0 text-[0.72rem] uppercase tracking-[0.08em] text-ink-soft sm:w-36">
                  {term}
                </dt>
                <dd className="flex-1 text-[0.88rem] leading-relaxed text-ink">{detail}</dd>
              </div>
            ))}
          </dl>
        </Stage>

        <div className="mt-6 space-y-3">

          <Detail summary="Why the interface and the API are one deployment">
            <p>
              They were two. Every page load meant a request from the browser to
              the interface and a second network hop from there to the API, six
              of them on the home screen alone, which put most of a second into
              every navigation purely in the app talking to itself.
            </p>
            <p>
              Merging them turned those hops into in-process function calls. The
              request handlers moved across unchanged behind a small adapter
              rather than being rewritten, because roughly 1,450 lines of
              already-debugged request handling is not something to retype for
              tidiness. The adapter is the only new surface, which puts all of
              the risk in one file that can be tested directly.
            </p>
          </Detail>

          <Detail summary="How this page stays fast, and why it can never leak">
            <p>
              This walkthrough is prerendered at build time and performs no data
              access of any kind. It is the only route outside the session check,
              so rather than trusting it to behave, a test walks its imports and
              fails the build if any of them can reach the database, a connected
              account or a calendar. Every figure you have read on it is invented.
            </p>
            <p>
              Motion is gated the same way. Entrances start hidden and are
              revealed by script, which means three separate ways a visitor could
              be left looking at a blank page: a reduced-motion preference,
              scripting disabled, or no intersection observer. Each has its own
              explicit override, and two of them are covered by tests, because
              the failure is silent and looks like an empty screen rather than an
              error.
            </p>
          </Detail>

        </div>
      </Section>

      {/* pt matches Section's, so the last seam reads the same as every other
          one now that sections no longer pad their own bottoms. */}
      <footer className="mx-auto w-full max-w-[46rem] px-5 pb-20 pt-16 sm:pt-24">
        <div className="rounded-card border border-[var(--line)] bg-card p-6 shadow-lift sm:p-8">

          <h2 className="pos-display text-[1.6rem] leading-tight text-ink">
            That is the walkthrough.
          </h2>

          <p className="mt-3 max-w-[34rem] text-[0.92rem] leading-relaxed text-ink-soft">
            Access is invitation only, so there is no sign-up form here — but
            there is a demo: the whole dashboard, running on fictional data,
            read-only. The passphrase for it is simply <span className="pos-data text-ink">demo</span>.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">

            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-3 text-[0.88rem] font-medium text-paper transition-opacity hover:opacity-90"
            >
              Sign in
              <span aria-hidden="true">→</span>
            </Link>

            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-[var(--r-pill)] border border-[var(--line)] px-5 py-3 text-[0.88rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              Try the demo
            </Link>

          </div>

        </div>

        <p className="pos-data mt-6 text-center text-[0.7rem] text-ink-soft">
          Almanac
        </p>
      </footer>

    </div>
  );

}
