import Link from "next/link";
import { formatDate } from "./shared.js";
import ResolveButton from "./ResolveButton.js";
import DeepThoughtThread from "./DeepThoughtThread.js";
import ProjectCard from "./ProjectCard.js";
import ReadAloud from "./ReadAloud.js";
import PromptCard from "./PromptCard.js";
import InsightCard from "./InsightCard.js";
import { backendGet } from "./backend.js";
import Reveal from "./Reveal.js";
import { Page, Card, SectionTitle, ItemCard, Body, Meta, Empty, btn } from "./ui.js";
import { speakable } from "../lib/linkify.js";


// Every page here reads live state, so none of them may be prerendered.
//
// This was previously implicit: backendGet used fetch(..., { cache: "no-store" }),
// and that opted the route out of static generation as a side effect. Now that
// the same call is a direct in-process function call there is no fetch for Next
// to notice, so without this the page is prerendered at build time and serves
// build-time data until the next deploy. The build output is where this shows
// up — a page marked (Static) that should be (Dynamic).
export const dynamic = "force-dynamic";


// Server Actions inherit their timeout from the page that invokes them, and
// respondToThread runs a gpt-5.6-sol call. Without this they die at the
// platform default and the dashboard shows a bare server error.
export const maxDuration = 60;


async function getBrief() {

  try {

    return await backendGet("/api/brief/latest?peek=true");

  } catch (error) {

    return { success: false, hasBrief: false, error: error.message };

  }

}


async function getPendingDeepThoughts() {

  try {

    // Turns come embedded now — the backend used to need one extra round
    // trip per pending thought to fetch them separately, and each of those
    // was a full hop to a different Vercel project, not just a Supabase
    // query. See getPendingDeepThoughts in tools/database.js.
    const data = await backendGet("/api/deepThoughts");

    return data.thoughts || [];

  } catch (error) {

    return [];

  }

}


// Prompts and insights come back together — one round trip, because they are
// the same thing from here: something the app raised on its own that is
// waiting on you. They stay in separate arrays because answering one is not
// answering the other.
async function getPendingPrompts() {

  try {

    const data = await backendGet("/api/data?prompts=1");

    return { prompts: data.prompts || [], insights: data.insights || [] };

  } catch (error) {

    return { prompts: [], insights: [] };

  }

}


// The search, on the page he opens every morning. A posting is worth applying
// to the day it appears, so it belongs where he already looks rather than
// behind two taps on another tab.
async function getJobHeadline() {

  try {

    const data = await backendGet("/api/jobs?headline=1");

    return data?.headline || null;

  } catch (error) {

    return null;

  }

}


async function getPendingNudges() {

  try {

    const data = await backendGet("/api/nudges");

    return data.nudges || [];

  } catch (error) {

    return [];

  }

}


async function getActiveProjects() {

  try {

    const data = await backendGet("/api/projects");

    return data.projects || [];

  } catch (error) {

    return [];

  }

}


// Small counts read better as words, and the headline is set large enough that
// a numeral would look like a notification badge rather than a sentence.
const WORDS = ["Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function countWord(n) {
  return n < WORDS.length ? WORDS[n] : String(n);
}


// This replaces the greeting-plus-week-strip the reference app opens with. A
// week strip is right for something where days are the axis you navigate — a
// habit tracker with streaks. Nothing in PersonalOS is per-day browsable, so
// it would have been decoration occupying the most valuable space on the page.
//
// The one true, useful thing to say at the top is how much is on his plate.
// It needs no clock, no timezone and no hydration dance to be correct, and it
// states the app's whole thesis in the largest type on the screen.
function Headline({ waiting, projectCount }) {

  const clear = waiting === 0;

  return (
    <header className="mb-7">

      <h1 className="pos-display text-[2.6rem] leading-[1.05] text-ink">
        {clear ? (
          <>
            <span className="text-moss">You&apos;re clear.</span>
          </>
        ) : (
          <>
            <span className="text-ember">{countWord(waiting)}</span>{" "}
            {waiting === 1 ? "thing" : "things"}
            <br />
            {waiting === 1 ? "needs" : "need"} you.
          </>
        )}
      </h1>

      <Meta className="mt-3 block">
        {projectCount > 0
          ? `${projectCount} project${projectCount === 1 ? "" : "s"} running`
          : "No projects running"}
      </Meta>

    </header>
  );

}


function NudgeCard({ item }) {

  return (
    <ItemCard kind="nudge" meta={formatDate(item.created_at)}>

      <div className="mt-3.5 flex items-start justify-between gap-3">
        <Body text={item.message} />
        <ReadAloud text={speakable(item.message)} title="Nudge" />
      </div>

      {item.intentions?.content && (
        <p className="mt-2 text-[0.82rem] text-ink-soft">
          Because you said: {item.intentions.content}
        </p>
      )}

      <ResolveButton type="nudge" id={item.id} />

    </ItemCard>
  );

}


export default async function Home() {

  const [brief, pendingThoughts, pendingNudges, projects, raised, jobs] = await Promise.all([
    getBrief(),
    getPendingDeepThoughts(),
    getPendingNudges(),
    getActiveProjects(),
    getPendingPrompts(),
    getJobHeadline()
  ]);

  const needsYou = [
    ...pendingThoughts.map(t => ({ ...t, kind: "thought" })),
    ...pendingNudges.map(n => ({ ...n, kind: "nudge" })),
    // kind is overwritten for card dispatch, so the row's OWN kind must ride
    // along under another name — PromptCard branches on it. Before this,
    // HEADINGS[item.kind] silently never resolved and label_place survived
    // only via its payload.place_id fallback.
    ...raised.prompts.map(p => ({ ...p, kind: "prompt", promptKind: p.kind })),
    // Insights had no surface at all before this: they existed only as a push,
    // so at any interruption level below "everything" — which is every level
    // they are tiered above — the finding was written and then unreachable.
    ...raised.insights.map(i => ({ ...i, kind: "insight" }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <Page>

      {/* One Reveal for the whole page rather than one per card: the stagger
          only reads as a deliberate sequence if a single component knows the
          order of everything in it. See app/motion.js. */}
      <Reveal gap={70}>

      <div className="pos-reveal" data-reveal>
        <Headline waiting={needsYou.length} projectCount={projects.length} />
      </div>

      {/* The search sits above the brief when it has something to say. An
          internship is worth applying to the day it appears, and the brief is
          prose he might skim; this is the one line he cannot miss. */}
      {jobs && (jobs.freshCount > 0 || jobs.closingCount > 0) && (
        <div className="pos-reveal" data-reveal>
          <Link href="/career/jobs" className="mb-5 block">
            <Card tone="sunken">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                  Internships
                </span>
                <span aria-hidden="true" className="text-[0.7rem] text-ink-soft">›</span>
              </div>
              <p className="mt-1.5 text-[0.95rem] leading-snug text-ink">
                {jobs.freshCount > 0 && (
                  <>
                    <span className="text-ember">{jobs.freshCount} new</span>
                    {jobs.lead ? ` — ${jobs.lead}` : ""}
                  </>
                )}
                {jobs.freshCount > 0 && jobs.closingCount > 0 && " · "}
                {jobs.closingCount > 0 && (
                  <span className="text-ember">
                    {jobs.closingCount} closing soon
                  </span>
                )}
              </p>
            </Card>
          </Link>
        </div>
      )}

      {/* Order is state-dependent by design. When something is waiting, it
          comes before the brief — the headline just said so, and scrolling
          past it to read prose would contradict that. When the queue is empty
          this block renders nothing at all, so the brief becomes the first
          card on the page with no special-casing. */}
      {needsYou.length > 0 && (
        <div className="mb-6 space-y-3">
          {needsYou.map((item) => (
            <div key={`${item.kind}-${item.id}`} className="pos-reveal" data-reveal>
              {item.kind === "thought"
                ? <DeepThoughtThread thought={item} turns={item.turns || []} />
                : item.kind === "prompt"
                  ? <PromptCard item={item} />
                  : item.kind === "insight"
                    ? <InsightCard item={item} />
                    : <NudgeCard item={item} />}
            </div>
          ))}
        </div>
      )}

      <div className="pos-reveal" data-reveal>
      <Card className="mb-6">

        <SectionTitle
          action={
            brief.hasBrief
              ? <ReadAloud text={speakable(brief.content)} title="Today's brief" label autoplay />
              : null
          }
        >
          Today&apos;s brief
        </SectionTitle>

        {brief.created_at && <Meta className="-mt-1 block">{formatDate(brief.created_at)}</Meta>}

        {brief.hasBrief ? (
          <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed text-ink">
            {brief.content}
          </div>
        ) : (
          <Empty>
            No brief yet today. It&apos;s written and pushed each morning —
            it&apos;ll land here on its own.
          </Empty>
        )}

        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <Link href="/history" className={btn("ghost")}>
            Earlier briefs
            <span aria-hidden="true">→</span>
          </Link>
        </div>

      </Card>
      </div>

      {projects.length > 0 && (
        <section>
          <div className="pos-reveal" data-reveal>
            <SectionTitle count={projects.length}>Projects</SectionTitle>
          </div>
          <div className="space-y-3">
            {projects.map(project => (
              <div key={project.id} className="pos-reveal" data-reveal>
                <ProjectCard project={project} />
              </div>
            ))}
          </div>
        </section>
      )}

      </Reveal>

    </Page>
  );

}
