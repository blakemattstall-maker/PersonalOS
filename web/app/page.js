import Link from "next/link";
import { formatDate } from "./shared.js";
import ResolveButton from "./ResolveButton.js";
import DeepThoughtThread from "./DeepThoughtThread.js";
import ProjectDeleteButton from "./ProjectDeleteButton.js";
import ReadAloud from "./ReadAloud.js";
import PromptCard from "./PromptCard.js";
import { backendGet } from "./backend.js";
import { Page, Card, SectionTitle, ItemCard, Meta, Empty, btn } from "./ui.js";


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


async function getPendingPrompts() {

  try {

    const data = await backendGet("/api/data?prompts=1");

    return data.prompts || [];

  } catch (error) {

    return [];

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
            need you.
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

      <p className="mt-3.5 leading-relaxed text-ink">{item.message}</p>

      {item.intentions?.content && (
        <p className="mt-2 text-[0.82rem] text-ink-soft">
          Because you said: {item.intentions.content}
        </p>
      )}

      <ResolveButton type="nudge" id={item.id} />

    </ItemCard>
  );

}


function ProjectCard({ project }) {

  const tasks = project.tasks || [];
  const done = tasks.filter(t => t.status === "completed").length;

  return (
    <div className="rounded-card bg-card p-5 shadow-lift">

      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">
          <h3 className="pos-display text-[1.05rem] text-ink">{project.name}</h3>
          {project.description && (
            <p className="mt-1 text-[0.85rem] leading-relaxed text-ink-soft">
              {project.description}
            </p>
          )}
        </div>

        <ProjectDeleteButton
          id={project.id}
          taskCount={tasks.length + (project.materials?.length || 0)}
        />

      </div>

      {project.next_action && (
        <div className="mt-4 rounded-item bg-[var(--sunken)] px-4 py-3">
          <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
            Next
          </div>
          <p className="mt-1 text-[0.9rem] leading-snug text-ink">{project.next_action}</p>
        </div>
      )}

      {tasks.length > 0 && (
        <>
          {/* A count and a bar rather than an unbounded checklist: this used to
              print every task on the dashboard, so a 12-task project buried
              everything below it. */}
          <div className="mt-4 flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-[var(--r-pill)] bg-[var(--sunken)]"
              role="img"
              aria-label={`${done} of ${tasks.length} tasks done`}
            >
              <div
                className="h-full rounded-[var(--r-pill)] bg-moss transition-[width]"
                style={{ width: `${Math.round((done / tasks.length) * 100)}%` }}
              />
            </div>
            <Meta>{done}/{tasks.length}</Meta>
          </div>

          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-[0.8rem] font-medium text-ink-soft hover:text-ink">
              <span className="group-open:hidden">Show tasks</span>
              <span className="hidden group-open:inline">Hide tasks</span>
            </summary>
            <ul className="mt-2.5 space-y-1.5">
              {tasks.map(t => (
                <li key={t.id} className="flex items-baseline gap-2 text-[0.85rem]">
                  <span className={t.status === "completed" ? "text-moss" : "text-[var(--line)]"}>
                    {t.status === "completed" ? "●" : "○"}
                  </span>
                  <span className={t.status === "completed" ? "text-ink-soft line-through" : "text-ink"}>
                    {t.title}
                  </span>
                  {t.due_date && <Meta className="ml-auto shrink-0">{formatDate(t.due_date)}</Meta>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {project.materials?.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {project.materials.map(m => (
            <details key={m.id} className="group text-[0.85rem]">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-ink-soft hover:text-ink">
                <span className="transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                {m.title}
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-ink-soft">
                {m.content}
              </p>
            </details>
          ))}
        </div>
      )}

    </div>
  );

}


export default async function Home() {

  const [brief, pendingThoughts, pendingNudges, projects, prompts] = await Promise.all([
    getBrief(),
    getPendingDeepThoughts(),
    getPendingNudges(),
    getActiveProjects(),
    getPendingPrompts()
  ]);

  const needsYou = [
    ...pendingThoughts.map(t => ({ ...t, kind: "thought" })),
    ...pendingNudges.map(n => ({ ...n, kind: "nudge" })),
    ...prompts.map(p => ({ ...p, kind: "prompt" }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <Page>

      <Headline waiting={needsYou.length} projectCount={projects.length} />

      {/* Order is state-dependent by design. When something is waiting, it
          comes before the brief — the headline just said so, and scrolling
          past it to read prose would contradict that. When the queue is empty
          this block renders nothing at all, so the brief becomes the first
          card on the page with no special-casing. */}
      {needsYou.length > 0 && (
        <div className="mb-6 space-y-3">
          {needsYou.map((item) => (
            item.kind === "thought"
              ? <DeepThoughtThread key={`thought-${item.id}`} thought={item} turns={item.turns || []} />
              : item.kind === "prompt"
                ? <PromptCard key={`prompt-${item.id}`} item={item} />
                : <NudgeCard key={`nudge-${item.id}`} item={item} />
          ))}
        </div>
      )}

      <Card className="mb-6">

        <SectionTitle
          action={
            brief.hasBrief
              ? <ReadAloud text={brief.content} title="Today's brief" label autoplay />
              : null
          }
        >
          Today&apos;s brief
        </SectionTitle>

        {brief.created_at && <Meta className="-mt-1 block">{formatDate(brief.created_at)}</Meta>}

        {brief.hasBrief ? (
          <div className="mt-3 whitespace-pre-wrap leading-relaxed text-ink">
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

      {projects.length > 0 && (
        <section>
          <SectionTitle count={projects.length}>Projects</SectionTitle>
          <div className="space-y-3">
            {projects.map(project => <ProjectCard key={project.id} project={project} />)}
          </div>
        </section>
      )}

    </Page>
  );

}
