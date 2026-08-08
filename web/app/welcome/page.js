import Link from "next/link";

import Hero from "./Hero.js";
import { Section, Detail, Mono, Stage } from "./parts.js";
import SceneCapture from "./SceneCapture.js";
import SceneGraph from "./SceneGraph.js";
import SceneBrief from "./SceneBrief.js";
import SceneNudge from "./SceneNudge.js";
import SceneMoney from "./SceneMoney.js";
import SceneEmber from "./SceneEmber.js";


// The signed-out door.
//
// This page reads nothing and is prerendered at build time, which is not an
// optimisation detail — it is the whole reason the page can exist. It is the
// only route in the app outside the session check, so it must not be able to
// reach Supabase, the bank connection or Google even by accident. There is no
// data-fetching call anywhere below; every figure on this page is written into
// the source as an illustration and is labelled as one.
export const metadata = {
  title: "PersonalOS — it reads the day before you do",
  description:
    "A tour of one person's operating system: passive capture, an entity graph that links every domain to every other, and an assistant that interrupts only when something is genuinely waiting.",
  openGraph: {
    title: "PersonalOS — it reads the day before you do",
    description:
      "Passive capture, a graph that connects money to people to projects, and an assistant that earns each interruption. Take the tour.",
    type: "website"
  }
};


const DETECTORS = [
  {
    name: "relationship_debt",
    plain: "Someone you said you'd stay close to has gone quiet, and you're about to see them anyway.",
    found: "Cooper — 19 days, cadence 14. You have a sponsor sync with him Thursday."
  },
  {
    name: "contradiction",
    plain: "Two things you've said at different times can't both be true.",
    found: "You said you're transferring Fall 2027 and graduating May 2029. One of those has changed."
  },
  {
    name: "project_cost",
    plain: "Real money has been spent on something you haven't been counting as expensive.",
    found: "$84 Staples matched to the sponsorship deck. Project cost so far: $84."
  },
  {
    name: "concentration",
    plain: "One thing is quietly eating a disproportionate share of your attention or your money.",
    found: "Four of the last six evening blocks went to the same stalled project."
  }
];


const STACK = [
  ["Frontend & API", "Next.js 16 App Router on Vercel — one project, one deploy. Route handlers, server actions, per-segment Suspense."],
  ["Store", "Supabase Postgres. Every domain is its own table; entity_links is the edge layer joining them."],
  ["Passive inputs", "Google Calendar, Tasks, Gmail and Docs; a bank feed via SimpleFIN; location; an iOS Shortcut that accepts text or a voice recording."],
  ["Out", "Web Push with VAPID, straight to the phone's lock screen. Every notification deep-links to the thing it is about."],
  ["Models", "Tiered by job — a cheap model to classify, a strong one to judge. Neither is ever asked to do arithmetic."],
  ["Running cost", "Under $10 a month, all in."]
];


export default function Welcome() {

  return (
    <div className="bg-paper">

      <Hero />

      <Section
        id="capture"
        eyebrow="01 · Capture"
        title="Say it once, in passing."
        lede="One sentence into a phone — typed or spoken — and it is parsed, dated, filed to the right place, and attached to everything it touches. No forms, no categories to pick, no app to open."
        tech={
          <>
            <p>
              The iOS Shortcut posts text or an audio recording to <Mono>/api/capture</Mono>.
              A classification pass decides what kind of thing was said; a second pass
              extracts the fields for that kind.
            </p>
            <p>
              Relative dates are resolved <em>at capture time</em> by <Mono>lib/resolveDates.js</Mono> and
              stored absolute. This is the single most expensive bug this project
              has shipped: storing the phrase and resolving it at read time meant
              the app spent a week announcing that an internship which had already
              ended was ending &ldquo;tomorrow&rdquo;.
            </p>
            <p>
              A dedup layer sits in front of the write, so saying the same thing
              twice in a week produces one record and a note that you&apos;ve now said
              it twice — which is itself a signal worth keeping.
            </p>
          </>
        }
      >
        <SceneCapture />
      </Section>

      <Section
        id="graph"
        eyebrow="02 · The graph"
        title="Nothing here is an island."
        lede="Most personal apps keep neat separate lists: contacts here, spending there, notes somewhere else. The interesting things live in between them — that a charge belongs to a project, that an evening belongs to a person, that a place is where two different things actually get done."
        tech={
          <>
            <p>
              Edges live in one table, <Mono>entity_links</Mono>, keyed on
              <Mono>(from_type, from_id, to_type, to_id, relation)</Mono> and written
              with an upsert — so re-running extraction over the same text is free
              rather than duplicative.
            </p>
            <p>
              Extraction matches text against entities that actually exist, on
              whole-word boundaries, and never on a model&apos;s impression that two
              things feel related. Names under three characters are ignored
              outright; the false-positive rate on those swamps anything they find.
              A wrong edge is worse than a missing one, because everything
              downstream treats edges as fact.
            </p>
            <p>
              <Mono>neighbours()</Mono> returns both directions and preserves which
              is which — &ldquo;this memory mentions Cooper&rdquo; and &ldquo;Cooper is mentioned by
              this memory&rdquo; are the same edge but not the same sentence.
            </p>
          </>
        }
      >
        <SceneGraph />
      </Section>

      <Section
        id="insights"
        eyebrow="03 · Insights"
        title="Then it goes looking."
        lede="A graph on its own is a diagram. What makes it useful is a set of detectors that walk it on a schedule, looking for the specific shapes that mean something — and that stay quiet when they don't find one."
        tech={
          <>
            <p>
              Each detector is a plain function over the graph, not a prompt. It
              either matches a shape or it doesn&apos;t, so a finding can be traced back
              to the rows that produced it and the same input always produces the
              same output.
            </p>
            <p>
              A model is involved only at the last step, to phrase a finding that
              has already been established. Findings are deduplicated against what
              has recently been delivered, then handed to the same notification
              budget everything else goes through — an insight is not exempt from
              being an interruption.
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
      </Section>

      <Section
        id="brief"
        eyebrow="04 · The morning brief"
        title="Facts in code. Judgement in the model."
        lede="Every number in the brief is calculated in JavaScript before a model sees anything. The model is handed those as settled facts and asked only to decide what matters today and say it in three short paragraphs."
        tech={
          <>
            <p>
              <Mono>gatherBriefFacts()</Mono> pulls calendar, tasks, people, projects,
              standing intentions, the inbox and cross-domain signals in parallel.
              Each source settles independently: a brief missing the money line is
              still a brief, but a brief that fails to render because Gmail was slow
              is not.
            </p>
            <p>
              Event kinds are classified in code too — a meeting with other people,
              an appointment, an hour set aside for yourself and a bare reminder are
              not the same thing and must not be described as if they were.
              Overlaps are detected before the prompt is built, so the model states
              a collision rather than spotting one.
            </p>
            <p>
              The system prompt says it explicitly: do no arithmetic. A model that
              does its own arithmetic will occasionally be wrong and will always
              sound certain.
            </p>
          </>
        }
      >
        <SceneBrief />
      </Section>

      <Section
        id="nudges"
        eyebrow="05 · The interruption budget"
        title="Most of the work is deciding not to send."
        lede="Anything that can push to your lock screen has to earn it every single time. The engine generates candidates freely and then spends most of its effort throwing them away."
        tech={
          <>
            <p>
              Hard limits, not heuristics: at most two nudges per run, and never
              two about the same intention inside three days. Candidates are batched
              and deduplicated before anything is sent, which is what stops the
              failure mode this actually had — three notifications about one event
              before breakfast.
            </p>
            <p>
              Each kind of message declares a minimum urgency tier, and those tiers
              are matched against the notification setting rather than compared as
              free-form strings. That mismatch was a real bug: the two vocabularies
              had drifted, so a setting of &ldquo;everything&rdquo; silently delivered
              nothing. There is now a test that fails if the two ever disagree again.
            </p>
            <p>
              Delivery windows are per-kind. A relationship check-in goes out in the
              morning; a nudge about an evening block goes out in the late afternoon.
              Nothing is delivered overnight, because a notification you read at 7am
              in a stack of six is a notification you dismiss.
            </p>
          </>
        }
      >
        <SceneNudge />
      </Section>

      <Section
        id="money"
        eyebrow="06 · Money"
        title="Your bank sends no categories. So it derives them."
        lede="A month of spending, split by where it actually went, with the repeating charges pulled out separately — those are the ones most worth re-deciding."
        tech={
          <>
            <p>
              Categorisation is rule-first and model-second: a merchant is matched
              against an ordered rule list, and only an unrecognised one is escalated
              to a model, whose answer is then cached. Rule order carries real
              meaning — transport is tested before groceries, or &ldquo;Costco Gas&rdquo; is
              filed as food.
            </p>
            <p>
              Recurring charges are found structurally — same merchant, same rough
              amount, more than once — rather than by matching a list of known
              subscription names.
            </p>
            <p>
              One bank call every twelve hours, cached, then sliced locally for
              whatever window the page asks for. Every figure on the money page is
              computed server-side; no model produced any number on it.
            </p>
          </>
        }
      >
        <SceneMoney />
      </Section>

      <Section
        id="design"
        eyebrow="07 · The rule"
        title="One colour, one meaning."
        lede="Orange appears in exactly one circumstance in this entire app: something is waiting on you. Not links, not headings, not focus rings, not buttons that merely save a form. When the queue is empty there is no orange on screen at all."
        tech={
          <>
            <p>
              An accent used for emphasis is an accent that has stopped carrying
              information. Reserving it costs a design its easiest tool and buys
              something better: a colour you can respond to without reading.
            </p>
            <p>
              Everything else is carried by two hues and a set of neutrals with a
              slight green bias. Secondary text was measured rather than eyeballed —
              the obvious grey came out at 3.8:1 on the page ground, under AA, so it
              was darkened to 4.7:1. Both themes are designed, not inverted.
            </p>
          </>
        }
      >
        <SceneEmber />
      </Section>

      <Section
        id="stack"
        eyebrow="08 · Under the hood"
        title="What it's actually made of."
        lede="One person, no formal coding background, building it in the open. Everything below runs today."
      >
        <Stage minH="min-h-0">
          <dl className="divide-y divide-[var(--line)]">
            {STACK.map(([term, detail]) => (
              <div key={term} className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-6">
                <dt className="pos-data shrink-0 text-[0.72rem] uppercase tracking-[0.08em] text-ink-soft sm:w-40">
                  {term}
                </dt>
                <dd className="flex-1 text-[0.88rem] leading-relaxed text-ink">{detail}</dd>
              </div>
            ))}
          </dl>
        </Stage>

        <div className="mt-6">
          <Detail summary="Why one Vercel project instead of two">
            <p>
              The API used to be a separate deployment, which meant every dashboard
              read was a browser hop to the frontend and a second network hop from
              there to the backend — 700ms to 1.5s per page, most of it spent
              waiting on the app talking to itself.
            </p>
            <p>
              Folding them together turned those into in-process function calls.
              The handler code moved across byte-identical behind a small adapter,
              rather than being rewritten — 1,450 lines of already-debugged request
              handling is not something to retype for tidiness.
            </p>
          </Detail>
        </div>
      </Section>

      <footer className="mx-auto w-full max-w-[46rem] px-5 pb-20 pt-4">
        <div className="rounded-card border border-[var(--line)] bg-card p-6 shadow-lift sm:p-8">

          <h2 className="pos-display text-[1.6rem] leading-tight text-ink">
            That&apos;s the tour.
          </h2>

          <p className="mt-3 max-w-[34rem] text-[0.92rem] leading-relaxed text-ink-soft">
            This is a personal system with exactly one user, so there is no sign-up
            behind this page — nothing to create, nothing to subscribe to. If you
            were given a passphrase, it goes in here.
          </p>

          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-3 text-[0.88rem] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Sign in
            <span aria-hidden="true">→</span>
          </Link>

        </div>

        <p className="pos-data mt-6 text-center text-[0.7rem] text-ink-soft">
          PersonalOS · built in the open
        </p>
      </footer>

    </div>
  );

}
