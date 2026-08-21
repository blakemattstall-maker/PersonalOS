"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { setJobStatusAction, saveSettingsAction } from "./actions.js";
import { Card, SectionTitle, Empty, Meta, btn } from "./ui.js";


// The feed. Ordered by when WE first saw it rather than by the company's own
// posted date: the whole promise of this page is "you are seeing this early",
// and first_seen_at is the only column that never lies about that (an ATS
// backdates, leaves the field null, or re-publishes an old req at will).

const FILTERS = [
  { key: "new", label: "New" },
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "all", label: "All" }
];

// Four ways to read the same list, because "what should I open next" has four
// different right answers depending on the day.
const SORTS = [
  { key: "recent", label: "Newest" },
  { key: "nearby", label: "Nearby" },
  { key: "pay", label: "Pay" },
  { key: "match", label: "Best fit" }
];

const NEARBY = /\b(chicago|illinois|\bil\b|evanston|bloomington|normal|naperville|schaumburg|deerfield|mettawa|milwaukee|indianapolis|st\.? louis)\b/i;

const isNearby = (p) => NEARBY.test(p.location || "");

// Hourly, so an hourly rate and a salary can share one sorted list.
const payRank = (p) => {
  if (p.pay_min == null) return -1;
  return p.pay_period === "year" ? Number(p.pay_min) / 2080 : Number(p.pay_min);
};

function payLabel(p) {
  if (p.pay_min == null) return null;
  const unit = p.pay_period === "year" ? "/yr" : "/hr";
  const fmt = (v) => p.pay_period === "year"
    ? `$${Math.round(Number(v) / 1000)}k`
    : `$${Number(v).toFixed(0)}`;
  return p.pay_max && Number(p.pay_max) !== Number(p.pay_min)
    ? `${fmt(p.pay_min)}–${fmt(p.pay_max)}${unit}`
    : `${fmt(p.pay_min)}${unit}`;
}


function when(iso) {

  if (!iso) return null;

  const then = DateTime.fromISO(iso);

  if (!then.isValid) return null;

  const hours = DateTime.now().diff(then, "hours").hours;

  // Inside a day, the exact hour is the point — it is the difference between
  // "apply now" and "you are already late".
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;

  return then.toRelative();

}


function Posting({ posting, onStatus, busy }) {

  const seen = when(posting.first_seen_at);

  const hot = posting.first_seen_at &&
    DateTime.now().diff(DateTime.fromISO(posting.first_seen_at), "hours").hours < 24;

  return (
    <li className="border-t border-[var(--line)] py-3.5 first:border-t-0">

      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[0.9rem] font-medium leading-snug text-ink">{posting.title}</span>
          <span className="mt-0.5 block text-[0.78rem] text-ink-soft">
            {posting.company}
            {posting.location ? ` · ${posting.location}` : ""}
            {payLabel(posting) ? ` · ${payLabel(posting)}` : ""}
            {posting.term === "summer_2027" ? " · Summer 2027" : ""}
          </span>
        </span>
        {seen && (
          <span className={`shrink-0 text-[0.7rem] ${hot ? "text-ember" : "text-ink-soft"}`}>{seen}</span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">

        {/* The point of the whole feature: one tap from notification to
            application form. */}
        <a
          href={posting.url}
          target="_blank"
          rel="noreferrer"
          className={btn("ember", "md")}
        >
          Open posting
        </a>

        {posting.status !== "applied" && (
          <button onClick={() => onStatus(posting.id, "applied")} disabled={busy} className={btn("quiet")}>
            Applied
          </button>
        )}

        {posting.status !== "saved" && posting.status !== "applied" && (
          <button onClick={() => onStatus(posting.id, "saved")} disabled={busy} className={btn("quiet")}>
            Save
          </button>
        )}

        <button onClick={() => onStatus(posting.id, "dismissed")} disabled={busy} className={btn("quiet")}>
          Not for me
        </button>

      </div>

    </li>
  );

}


export default function JobsView({ postings, watching, broken, lastCheckedAt, locationPriority = true }) {

  const router = useRouter();

  const [filter, setFilter] = useState("new");
  const [sort, setSort] = useState("recent");
  const [nearby, setNearby] = useState(locationPriority);
  const [isPending, startTransition] = useTransition();

  // Chicago-first is right for this summer and wrong the moment he wants
  // Seattle or New York, so it is a switch rather than a constant. It only
  // reorders and re-ranks; nothing is ever collected differently.
  const toggleNearby = () => {
    const next = !nearby;
    setNearby(next);
    startTransition(async () => {
      await saveSettingsAction({ jobs_location_priority: next });
      router.refresh();
    });
  };

  const onStatus = (id, status) => {
    startTransition(async () => {
      await setJobStatusAction(id, status);
      router.refresh();
    });
  };

  const chosen = filter === "all"
    ? postings
    : postings.filter(p => p.status === filter);

  // Sorted in the client because the whole list is already here — 120 rows at
  // most — and a re-sort should not cost a round trip.
  const shown = [...chosen].sort((a, b) => {

    if (sort === "nearby") {
      const diff = Number(isNearby(b)) - Number(isNearby(a));
      if (diff !== 0) return diff;
    }

    if (sort === "pay") {
      const diff = payRank(b) - payRank(a);
      if (diff !== 0) return diff;
    }

    if (sort === "match") {
      const diff = (b.match_score || 0) - (a.match_score || 0);
      if (diff !== 0) return diff;
    }

    // Newest is the tiebreaker for every mode: of two equally good roles, the
    // one posted an hour ago is the one still worth applying to first.
    return new Date(b.first_seen_at) - new Date(a.first_seen_at);

  });

  return (
    <>

      <div className="mb-4 flex gap-1 self-start rounded-[var(--r-pill)] border border-[var(--line)] p-1">
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-[var(--r-pill)] px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors ${
              filter === f.key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[0.7rem] uppercase tracking-[0.08em] text-ink-soft">Sort</span>
        {SORTS.map(o => (
          <button
            key={o.key}
            type="button"
            onClick={() => setSort(o.key)}
            aria-pressed={sort === o.key}
            className={`rounded-[var(--r-pill)] border px-3 py-1 text-[0.75rem] transition-colors ${
              sort === o.key ? "border-ink text-ink" : "border-[var(--line)] text-ink-soft hover:border-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (

        <Empty>
          {filter === "new"
            ? "Nothing new since the last check. The moment a matching internship posts, it lands here and your phone buzzes."
            : `Nothing ${filter} yet.`}
        </Empty>

      ) : (

        <Card>
          <SectionTitle count={shown.length}>
            {FILTERS.find(f => f.key === filter)?.label}
          </SectionTitle>
          <ul>
            {shown.map(p => (
              <Posting key={p.id} posting={p} onStatus={onStatus} busy={isPending} />
            ))}
          </ul>
        </Card>

      )}

      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <button
          onClick={toggleNearby}
          disabled={isPending}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm text-ink">Favour Chicago and the Midwest</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
              Ranks nearby roles above the coasts. Turn it off to weigh Seattle,
              the Bay and New York evenly — nothing is filtered out either way.
            </span>
          </span>
          <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            nearby ? "border-moss text-moss" : "border-[var(--line)] text-ink-soft"
          }`}>
            {nearby ? "On" : "Off"}
          </span>
        </button>
      </div>

      <div className="mt-4">
        <Meta>
          Watching {watching} company board{watching === 1 ? "" : "s"}
          {lastCheckedAt ? ` · last checked ${when(lastCheckedAt)}` : " · never checked yet"}.
        </Meta>
        {/* A board that has started failing must be visible. A renamed company
            slug returns 404 forever and looks exactly like a quiet hiring
            market. */}
        {broken.length > 0 && (
          <p className="mt-1.5 text-[0.75rem] text-ember">
            Not responding: {broken.join(", ")} — the board moved or was renamed.
          </p>
        )}
      </div>

    </>
  );

}
