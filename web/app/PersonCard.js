"use client";

import { useState, useTransition } from "react";
import { deletePersonAction, logContactAction } from "./actions.js";
import { formatDate } from "./shared.js";


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


function formatCheckIn(days) {
  if (!days) return null;
  if (days % 30 === 0) return `every ${days / 30 === 1 ? "month" : `${days / 30} months`}`;
  if (days % 7 === 0) return `every ${days / 7 === 1 ? "week" : `${days / 7} weeks`}`;
  return `every ${days} days`;
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
    <div className="rounded-2xl border border-border bg-surface p-6">

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground">{person.name}</h3>
          {person.relationship && <p className="mt-0.5 text-xs text-muted">{person.relationship}</p>}
        </div>
        <button
          onClick={remove}
          disabled={isPending}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
        >
          Remove
        </button>
      </div>

      {person.notes && (
        <p className="mt-2 text-sm text-foreground leading-relaxed">{person.notes}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {person.email && <span>{person.email}</span>}
        {person.phone && <span>{person.phone}</span>}
        {person.important_date_month && (
          <span>
            {person.important_date_label || "Important date"}: {MONTHS[person.important_date_month - 1]} {person.important_date_day}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">

        <div className="text-xs text-muted">
          {person.last_contacted_at
            ? `Last contact: ${formatDate(person.last_contacted_at)}`
            : "No contact logged yet"}
          {checkIn && (
            <span className={isDue ? "ml-2 text-accent" : "ml-2"}>
              · checking in {checkIn}{isDue ? " — due" : ""}
            </span>
          )}
        </div>

        <button
          onClick={logContact}
          disabled={isPending}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {isPending ? "…" : "Log contact"}
        </button>

      </div>

      {note && <p className="mt-2 text-xs text-muted">{note}</p>}

    </div>
  );

}
