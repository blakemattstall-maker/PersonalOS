import Link from "next/link";
import { formatDate } from "./shared.js";
import ResolveButton from "./ResolveButton.js";
import DeepThoughtThread from "./DeepThoughtThread.js";
import ProjectDeleteButton from "./ProjectDeleteButton.js";
import ReadAloud from "./ReadAloud.js";
import PromptCard from "./PromptCard.js";
import { backendGet } from "./backend.js";


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

    const data = await backendGet("/api/deepThoughts");

    const thoughts = data.thoughts || [];

    const withTurns = await Promise.all(
      thoughts.map(async (t) => {

        try {

          const turnsData = await backendGet(`/api/deepThoughts?turns=${t.id}`);

          return { ...t, turns: turnsData.turns || [] };

        } catch (error) {

          return { ...t, turns: [] };

        }

      })
    );

    return withTurns;

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


function NudgeCard({ item }) {

  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">Nudge</div>
      <p className="mt-1 text-foreground leading-relaxed">{item.message}</p>
      {item.intentions?.content && (
        <p className="mt-1 text-xs text-muted">Re: {item.intentions.content}</p>
      )}
      <ResolveButton type="nudge" id={item.id} />
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
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        {/* flex-wrap on both levels: four nav items plus the title no longer
            fit on one line on a phone. Wraps to a title row and a nav row
            rather than overflowing or overlapping. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold text-foreground">PersonalOS</h1>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/news" className="text-sm text-muted hover:text-accent">
              News
            </Link>
            <Link href="/fund" className="text-sm text-muted hover:text-accent">
              Fund
            </Link>
            <Link href="/practice" className="text-sm text-muted hover:text-accent">
              Practice
            </Link>
            <Link href="/people" className="text-sm text-muted hover:text-accent">
              People
            </Link>
            <Link href="/data" className="text-sm text-muted hover:text-accent">
              Data
            </Link>
            <Link href="/history" className="text-sm text-muted hover:text-accent">
              History
            </Link>
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="text-lg leading-none text-muted hover:text-accent"
            >
              ⚙
            </Link>
          </div>
        </div>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-6">

          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Needs You
          </h2>

          {needsYou.length === 0 ? (

            <p className="mt-4 text-muted">
              Nothing waiting on you right now.
            </p>

          ) : (

            <div className="mt-4 space-y-8">
              {needsYou.map((item) => (
                item.kind === "thought"
                  ? <DeepThoughtThread key={`thought-${item.id}`} thought={item} turns={item.turns || []} />
                  : item.kind === "prompt"
                    ? <PromptCard key={`prompt-${item.id}`} item={item} />
                    : <NudgeCard key={`nudge-${item.id}`} item={item} />
              ))}
            </div>

          )}

        </section>

        {projects.length > 0 && (

          <section className="mt-6 rounded-2xl border border-border bg-surface p-6">

            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Projects
            </h2>

            <div className="mt-4 space-y-6">
              {projects.map((project) => (
                <div key={project.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">

                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-foreground">{project.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">{project.status}</span>
                      <ProjectDeleteButton
                        id={project.id}
                        taskCount={(project.tasks?.length || 0) + (project.materials?.length || 0)}
                      />
                    </div>
                  </div>

                  {project.description && (
                    <p className="mt-1 text-sm text-muted">{project.description}</p>
                  )}

                  {project.next_action && (
                    <p className="mt-2 text-sm text-foreground">
                      <span className="text-muted">Next: </span>{project.next_action}
                    </p>
                  )}

                  {project.tasks?.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {project.tasks.map(t => (
                        <li key={t.id}>
                          {t.status === "completed" ? "✓" : "○"} {t.title}
                          {t.due_date && ` — ${formatDate(t.due_date)}`}
                        </li>
                      ))}
                    </ul>
                  )}

                  {project.materials?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {project.materials.map(m => (
                        <details key={m.id} className="text-sm">
                          <summary className="cursor-pointer text-accent">{m.title}</summary>
                          <p className="mt-1 whitespace-pre-wrap text-muted">{m.content}</p>
                        </details>
                      ))}
                    </div>
                  )}

                </div>
              ))}
            </div>

          </section>

        )}

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Today
            </h2>
            <div className="flex items-center gap-3">
              {brief.created_at && (
                <span className="text-sm text-muted">{formatDate(brief.created_at)}</span>
              )}
              {brief.hasBrief && (
                <ReadAloud text={brief.content} title="Today's brief" label autoplay />
              )}
            </div>
          </div>

          <div className="mt-4 whitespace-pre-wrap text-foreground leading-relaxed">
            {brief.hasBrief
              ? brief.content
              : "Nothing yet today — check back after your morning brief runs."}
          </div>

        </section>

      </main>
    </div>
  );

}
