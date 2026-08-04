import Link from "next/link";
import { formatDate } from "../shared.js";
import DeleteButton from "../DeleteButton.js";
import { backendGet } from "../backend.js";


async function getData() {

  try {

    return await backendGet("/api/data");

  } catch (error) {

    return { memories: [], notes: [], intentions: [] };

  }

}


function Row({ type, id, primary, secondary }) {

  return (
    <div className="flex items-start justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{primary}</p>
        {secondary && <p className="mt-0.5 text-xs text-muted">{secondary}</p>}
      </div>
      <DeleteButton type={type} id={id} />
    </div>
  );

}


export default async function DataPage() {

  const { memories = [], notes = [], intentions = [] } = await getData();

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Manage Data</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Dashboard
          </Link>
        </div>

        <p className="mt-2 text-sm text-muted">
          Delete anything the AI saved that's wrong, outdated, or filed incorrectly.
        </p>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Memories ({memories.length})
          </h2>
          {memories.length === 0 ? (
            <p className="mt-3 text-sm text-muted">None saved.</p>
          ) : (
            <div className="mt-2">
              {memories.map(m => (
                <Row
                  key={m.id}
                  type="memory"
                  id={m.id}
                  primary={m.content}
                  secondary={`${m.type} · importance ${m.importance} · ${formatDate(m.created_at)}`}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Notes ({notes.length})
          </h2>
          {notes.length === 0 ? (
            <p className="mt-3 text-sm text-muted">None saved.</p>
          ) : (
            <div className="mt-2">
              {notes.map(n => (
                <Row
                  key={n.id}
                  type="note"
                  id={n.id}
                  primary={n.content}
                  secondary={formatDate(n.created_at)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Intentions ({intentions.length})
          </h2>
          {intentions.length === 0 ? (
            <p className="mt-3 text-sm text-muted">None saved.</p>
          ) : (
            <div className="mt-2">
              {intentions.map(i => (
                <Row
                  key={i.id}
                  type="intention"
                  id={i.id}
                  primary={i.content}
                  secondary={`${i.status} · ${formatDate(i.created_at)}`}
                />
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );

}
