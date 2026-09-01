"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { setJobStatusAction, saveSettingsAction, recordStageAction } from "./actions.js";
import { Card, SectionTitle, Empty, Meta, btn, field } from "./ui.js";


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
  { key: "match", label: "Best fit" },
  { key: "closing", label: "Closing" }
];

// Distance, in tiers rather than a yes/no. The old version was a single
// boolean that counted Milwaukee as "nearby" alongside Chicago, so a
// Wisconsin role could sit above an Illinois one — sorting by distance and
// then showing the wrong order is worse than not offering the sort.
const CHICAGO = /\b(chicago|evanston|naperville|schaumburg|deerfield|mettawa|oak brook|skokie|des plaines|rosemont|aurora|joliet)\b/i;
const ILLINOIS = /\b(illinois|\bil\b|bloomington|normal|peoria|champaign|springfield|rockford|moline)\b/i;
const MIDWEST = /\b(milwaukee|madison|wisconsin|\bwi\b|indianapolis|indiana|\bin\b|st\.? louis|missouri|\bmo\b|iowa|\bia\b|michigan|\bmi\b|minneapolis|minnesota|\bmn\b|ohio|\boh\b|kentucky|\bky\b)\b/i;

// Higher is closer to home.
function proximity(p) {
  const loc = p.location || "";
  if (CHICAGO.test(loc)) return 4;
  if (ILLINOIS.test(loc)) return 3;
  if (MIDWEST.test(loc)) return 2;
  if (loc) return 1;
  return 0;
}

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


// Days until applications close, when the posting said so.
function closingIn(deadline) {
  if (!deadline) return null;
  const days = Math.round((new Date(`${deadline}T23:59:59Z`) - Date.now()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "closes today";
  if (days === 1) return "closes tomorrow";
  if (days <= 14) return `closes in ${days}d`;
  return null;
}


function Posting({ posting, onStatus, busy }) {

  const seen = when(posting.first_seen_at);

  const closing = closingIn(posting.deadline);

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
        <span className="shrink-0 text-right">
          {seen && (
            <span className={`block text-[0.7rem] ${hot ? "text-ember" : "text-ink-soft"}`}>{seen}</span>
          )}
          {/* A closing date is the one piece of information that changes what
              he should do in the next hour. */}
          {closing && (
            <span className="mt-0.5 block text-[0.7rem] font-medium text-ember">{closing}</span>
          )}
        </span>
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


export default function JobsView({ postings, watching, broken, lastCheckedAt, stale = false, locationPriority = true }) {

  const router = useRouter();

  const [filter, setFilter] = useState("new");
  const [sort, setSort] = useState("recent");
  const [nearby, setNearby] = useState(locationPriority);
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState(() => new Set());
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
      // Applying opens a pipeline: the event is what the flow chart is built
      // from, and it sets the status too. Everything else is just a status.
      if (status === "applied") await recordStageAction(id, "applied");
      else await setJobStatusAction(id, status);
      router.refresh();
    });
  };

  // Two hours is four missed polls: past that, something is wrong with the
  // clock rather than with the market. Computed on the server — see
  // career/jobs/page.js — because reading the clock during a render is impure.

  // Search runs over company, title and location together, because he thinks in
  // all three — "tiktok", "chicago" and "social" are each a reasonable way to
  // find the same posting. Every term has to match somewhere, so "product
  // chicago" narrows rather than widens.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const searched = terms.length === 0
    ? postings
    : postings.filter(p => {
        const hay = `${p.company} ${p.title} ${p.location || ""}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      });

  const chosen = filter === "all"
    ? searched
    : searched.filter(p => p.status === filter);

  // Sorted in the client because the whole list is already here — 120 rows at
  // most — and a re-sort should not cost a round trip.
  const shown = [...chosen].sort((a, b) => {

    if (sort === "nearby") {
      const diff = proximity(b) - proximity(a);
      if (diff !== 0) return diff;
    }

    if (sort === "pay") {
      const diff = payRank(b) - payRank(a);
      if (diff !== 0) return diff;
    }

    if (sort === "closing") {
      // Postings with a stated deadline first, soonest at the top; everything
      // undated sits below rather than pretending to be urgent.
      const av = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bv = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (av !== bv) return av - bv;
    }

    if (sort === "match") {
      const diff = (b.match_score || 0) - (a.match_score || 0);
      if (diff !== 0) return diff;
    }

    // Newest is the tiebreaker for every mode: of two equally good roles, the
    // one posted an hour ago is the one still worth applying to first.
    return new Date(b.first_seen_at) - new Date(a.first_seen_at);

  });

  // ── grouped by employer ───────────────────────────────────────────────
  //
  // TikTok posted five product internships in a day and caps applicants at TWO
  // company-wide, so a flat list of five TikTok rows is actively misleading —
  // it looks like five opportunities and it is a choice between them. Grouping
  // makes the shape of the day visible: which employers are hiring in volume,
  // and where picking matters.
  //
  // Order is inherited from the sort, not recomputed: a group takes the rank of
  // its best posting, so "closing soonest" still puts the urgent employer first.
  const groups = [];
  const byCompany = new Map();

  for (const p of shown) {
    if (!byCompany.has(p.company)) {
      const g = { company: p.company, postings: [] };
      byCompany.set(p.company, g);
      groups.push(g);
    }
    byCompany.get(p.company).postings.push(p);
  }

  const toggleGroup = (company) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company); else next.add(company);
      return next;
    });
  };

  return (
    <>

      {/* Search first, because with hundreds of boards the list is no longer
          something you scroll. */}
      <div className="mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, title or city"
          aria-label="Search internships"
          className={field()}
        />
        {terms.length > 0 && (
          <p className="pos-data mt-1.5 text-[0.72rem] text-ink-soft">
            {searched.length} of {postings.length} match
            {searched.length === 0 && " — try fewer words"}
          </p>
        )}
      </div>

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
          <SectionTitle
            count={shown.length}
            action={
              groups.length < shown.length ? (
                <button
                  type="button"
                  onClick={() => setGrouped(g => !g)}
                  className="text-[0.72rem] text-ink-soft underline decoration-[var(--line)] underline-offset-[3px] hover:text-ink"
                >
                  {grouped ? "Show flat" : `Group by company (${groups.length})`}
                </button>
              ) : null
            }
          >
            {FILTERS.find(f => f.key === filter)?.label}
          </SectionTitle>

          {!grouped || groups.length === shown.length ? (

            <ul>
              {shown.map(p => (
                <Posting key={p.id} posting={p} onStatus={onStatus} busy={isPending} />
              ))}
            </ul>

          ) : (

            <ul className="divide-y divide-[var(--line)]">
              {groups.map(g => {

                // One role is not a group. Rendering it as a collapsed header
                // would hide a posting behind a tap for no reason.
                if (g.postings.length === 1) {
                  return (
                    <li key={g.company} className="py-1">
                      <Posting posting={g.postings[0]} onStatus={onStatus} busy={isPending} />
                    </li>
                  );
                }

                const expanded = open.has(g.company);
                const applied = g.postings.filter(p => p.status === "applied").length;

                return (
                  <li key={g.company} className="py-1">

                    <button
                      type="button"
                      onClick={() => toggleGroup(g.company)}
                      aria-expanded={expanded}
                      className="flex w-full items-baseline justify-between gap-3 py-2.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[0.95rem] font-medium text-ink">
                          {g.company}
                        </span>
                        <span className="pos-data mt-0.5 block text-[0.72rem] text-ink-soft">
                          {g.postings.length} roles
                          {applied > 0 && <span className="text-moss"> · {applied} applied</span>}
                          {" · best match "}
                          {Math.max(...g.postings.map(p => p.match_score || 0))}
                        </span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-[0.75rem] text-ink-soft">
                        {expanded ? "−" : "+"}
                      </span>
                    </button>

                    {expanded && (
                      <ul className="mb-2 border-l border-[var(--line)] pl-3">
                        {g.postings.map(p => (
                          <Posting key={p.id} posting={p} onStatus={onStatus} busy={isPending} />
                        ))}
                      </ul>
                    )}

                  </li>
                );

              })}
            </ul>

          )}
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

        {/* A scheduler that stops firing looks exactly like a quiet hiring
            market — which is precisely what happened when GitHub Actions
            silently never ran the schedule for over an hour. The page has to
            say so, or the first sign of trouble is a missed posting. */}
        {stale && (
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ember">
            No poll has completed in over two hours. The schedule may have
            stopped — new postings are not being caught right now.
          </p>
        )}
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
