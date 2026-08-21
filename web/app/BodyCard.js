"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logWeightAction } from "./actions.js";
import { Card, SectionTitle, Empty, btn, field } from "./ui.js";


// The body section of /health: what the scale says, and the fastest possible
// way to tell it something new.
//
// Weighing in was capture-only ("I'm 216 today") — which works, but it meant
// the one number every reasoning surface now leads with had no home in the app
// itself. The figures here are the same computed vitals the brief, the nudges
// and the health tool use (lib/vitals.js), so this page and the assistant can
// never quote different numbers at each other.


function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">{label}</div>
      <div className="pos-data mt-0.5 text-[1.15rem] leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-[0.7rem] leading-snug text-ink-soft">{sub}</div>}
    </div>
  );
}


export default function BodyCard({ vitals }) {

  const router = useRouter();

  const [weight, setWeight] = useState("");
  const [note, setNote] = useState(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {

    const value = Number(weight);

    if (!Number.isFinite(value) || value <= 0) {
      setNote("Enter a number.");
      return;
    }

    startTransition(async () => {
      const result = await logWeightAction(value);
      setNote(result?.success ? `Logged ${value} lbs.` : result?.error || "Couldn't save that.");
      if (result?.success) {
        setWeight("");
        router.refresh();
      }
    });

  };

  const unit = vitals?.unit || "lbs";

  const changeText = vitals
    ? `${vitals.totalChange > 0 ? "up" : "down"} ${Math.abs(vitals.totalChange)} ${unit} since ${vitals.start.date}`
    : null;

  return (
    <Card className="mb-3">

      <SectionTitle>Body</SectionTitle>

      {vitals ? (

        <>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat
              label="Now"
              value={`${vitals.current.weight}`}
              sub={vitals.daysSinceLast === 0 ? "today" : `${vitals.daysSinceLast}d ago`}
            />
            <Stat
              label="Change"
              value={`${vitals.totalChange > 0 ? "+" : ""}${vitals.totalChange}`}
              sub={`from ${vitals.start.weight}`}
            />
            <Stat
              label="Pace"
              value={vitals.pacePerWeek == null ? "—" : `${vitals.pacePerWeek > 0 ? "+" : ""}${vitals.pacePerWeek}`}
              sub={vitals.pacePerWeek == null ? "not enough recent data" : `${unit}/week, 30d`}
            />
          </div>

          {/* The one thing a weight page must never do is let a stale trend
              look current. */}
          {vitals.daysSinceLast > 7 && (
            <p className="mt-3 text-[0.75rem] leading-relaxed text-ember">
              No weigh-in for {vitals.daysSinceLast} days — the trend is going blind.
            </p>
          )}

          <p className="mt-3 text-[0.72rem] text-ink-soft">{changeText} · {vitals.count} weigh-ins</p>
        </>

      ) : (

        <Empty>
          No weigh-ins yet. Log one below, or just say &ldquo;I&rsquo;m 216 today&rdquo; to capture.
        </Empty>

      )}

      <div className="mt-4 flex items-end gap-2 border-t border-[var(--line)] pt-4">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder={`Today's weight (${unit})`}
          aria-label="Log today's weight"
          disabled={isPending}
          className={field("flex-1")}
        />
        <button
          onClick={save}
          disabled={isPending || !weight.trim()}
          className={`${btn("ember", "md")} shrink-0`}
        >
          {isPending ? "Saving…" : "Log"}
        </button>
      </div>

      {note && <p className="mt-2 text-[0.72rem] text-ink-soft">{note}</p>}

      {vitals?.recent?.length > 0 && (
        <details className="mt-3 border-t border-[var(--line)] pt-3">
          <summary className="cursor-pointer text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
            Recent weigh-ins
          </summary>
          <ul className="mt-2 space-y-1">
            {vitals.recent.map(line => (
              <li key={line} className="pos-data text-[0.75rem] text-ink-soft">{line}</li>
            ))}
          </ul>
        </details>
      )}

    </Card>
  );

}
