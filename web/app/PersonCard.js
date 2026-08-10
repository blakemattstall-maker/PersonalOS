"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { deletePersonAction, logContactAction } from "./actions.js";
import { formatDate } from "./shared.js";


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


function formatCheckIn(days) {
  if (!days) return null;
  if (days % 30 === 0) return `every ${days / 30 === 1 ? "month" : `${days / 30} months`}`;
  if (days % 7 === 0) return `every ${days / 7 === 1 ? "week" : `${days / 7} weeks`}`;
  return `every ${days} days`;
}


// "in 6 days" / "3 days ago" — the two questions actually being asked of this
// card are "when am I next nudged about this person" and "how long has it
// been", and a bare date makes you do that arithmetic yourself every time.
function relativeDays(iso) {

  if (!iso) return null;

  const then = new Date(iso);
  const now = new Date();

  // Compare calendar days, not elapsed milliseconds — otherwise something due
  // in 20 hours reads as "in 0 days" and something 30 hours ago reads as
  // "1 day ago" when both are colloquially "tomorrow" and "yesterday".
  const startOfDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startOfDay(then) - startOfDay(now)) / 86400000);

  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 0) return `in ${diff} days`;

  return `${Math.abs(diff)} days ago`;

}


export default function PersonCard({ person }) {

  const [isPending, startTransition] = useTransition();
  const [deleted, setDeleted] = useState(false);
  const [note, setNote] = useState(null);

  const remove = () => {

    if (!confirm(`Remove ${person.name}? This won't touch any calendar events already created.`)) return;

    startTransition(async () => {
      const result = await deletePersonAction(person.id);
      if (result?.success) setDeleted(true);
    });

  };

  const logContact = () => {

    startTransition(async () => {
      const result = await logContactAction(person.name);
      setNote(result?.message || null);
    });

  };

  if (deleted) return null;

  const checkIn = formatCheckIn(person.check_in_days);
  const isDue = person.next_check_in_at && new Date(person.next_check_in_at) <= new Date();

  return (
    <div className="rounded-card bg-card p-5 shadow-lift">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-ink">{person.name}</h3>
          {person.relationship && <p className="mt-0.5 text-xs text-ink-soft">{person.relationship}</p>}
        </div>
        <button
          onClick={remove}
          disabled={isPending}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ember hover:text-ember disabled:opacity-45"
        >
          Remove
        </button>
      </div>

      {person.notes && (
        <p className="mt-2 text-sm text-ink leading-relaxed">{person.notes}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {person.email && <span>{person.email}</span>}
        {person.phone && <span>{person.phone}</span>}
        {person.important_date_month && (
          <span>
            {person.important_date_label || "Important date"}: {MONTHS[person.important_date_month - 1]} {person.important_date_day}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">

        {/* Both halves of the check-in state, deliberately subtle: when it last
            happened and when the next nudge fires. Without the second one
            there's no way to tell a cadence that's working from one that
            silently stopped. */}
        <div className="space-y-0.5 text-xs leading-relaxed text-ink-soft">

          <div>
            {person.last_contacted_at ? (
              <>Last contact {relativeDays(person.last_contacted_at)}
                <span className="opacity-60"> · {formatDate(person.last_contacted_at)}</span>
              </>
            ) : "No contact logged yet"}
          </div>

          {checkIn && (
            <div>
              {isDue ? (
                <span className="font-medium text-ember">Check-in due now</span>
              ) : person.next_check_in_at ? (
                <>Next nudge {relativeDays(person.next_check_in_at)}</>
              ) : null}
              <span className="opacity-60"> · {checkIn}</span>
            </div>
          )}

        </div>

        <div className="flex shrink-0 items-center gap-2">

          {/* Everything this person turns up in — the notes that named them,
              the tasks owed to them, the evenings they were at. Scattered
              across five tables and reachable nowhere else in the app. */}
          <Link
            href={`/graph?type=person&id=${person.id}`}
            className="inline-flex items-center gap-1.5 rounded-[var(--r-pill)] px-2.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            Connections
            <span aria-hidden="true">→</span>
          </Link>

          <button
            onClick={logContact}
            disabled={isPending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
          >
            {isPending ? "…" : "Log contact"}
          </button>

        </div>

      </div>

      {note && <p className="mt-2 text-xs text-ink-soft">{note}</p>}

    </div>
  );

}
