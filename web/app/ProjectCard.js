import { formatDate } from "./shared.js";
import ProjectDeleteButton from "./ProjectDeleteButton.js";
import ProjectArchiveButton from "./ProjectArchiveButton.js";
import { Meta } from "./ui.js";


// Shared between Today (active projects) and Settings → Archived. `archived`
// only changes which icon the put-away control shows and whether delete's
// confirmation copy still applies — the project itself renders identically
// either way, tasks and materials included, since archiving never touches them.
export default function ProjectCard({ project, archived = false }) {

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

        <div className="flex shrink-0 items-center gap-0.5">
          <ProjectArchiveButton id={project.id} archived={archived} />
          <ProjectDeleteButton
            id={project.id}
            taskCount={tasks.length + (project.materials?.length || 0)}
          />
        </div>

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
