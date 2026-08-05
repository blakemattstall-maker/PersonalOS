import Link from "next/link";
import { backendGet } from "../backend.js";
import PersonCard from "../PersonCard.js";
import AddPersonForm from "../AddPersonForm.js";


export const dynamic = "force-dynamic";


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


export default async function People() {

  const data = await safeGet("/api/people", { success: false, people: [] });
  const people = data.people || [];

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">People</h1>
          <Link href="/" className="text-sm text-muted hover:text-accent">
            ← Back
          </Link>
        </div>

        <p className="mt-2 text-sm text-muted">
          Save someone once and the rest of the app can use it — an important
          date becomes a real calendar reminder, a check-in cadence brings a
          nudge when you&apos;ve gone quiet.
        </p>

        <div className="mt-8">
          <AddPersonForm />
        </div>

        {data.success === false && (
          <p className="mt-6 text-sm text-muted">
            Couldn&apos;t reach the backend.
          </p>
        )}

        {data.success !== false && people.length === 0 && (
          <p className="mt-6 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            No one saved yet.
          </p>
        )}

        {people.length > 0 && (
          <div className="mt-6 space-y-4">
            {people.map(p => <PersonCard key={p.id} person={p} />)}
          </div>
        )}

      </main>
    </div>
  );

}
