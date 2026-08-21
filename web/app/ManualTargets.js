"use client";

import { useState, useTransition } from "react";
import { MANUAL_TARGETS, MANUAL_GROUPS, isStale } from "../lib/manualTargets.js";
import { saveSettingsAction } from "./actions.js";
import { Card, SectionTitle, btn } from "./ui.js";


// The other half of the search.
//
// A feed of 183 boards makes it easy to believe everything is covered, and the
// places it cannot reach are not the leftovers — they are the giants everyone
// wants and the small studios where a single email actually gets read. Putting
// them on the same page as the automated feed is the point: this is the list
// the poller cannot do for him.


function ago(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "checked today";
  if (days === 1) return "checked yesterday";
  return `checked ${days}d ago`;
}


function Target({ target, checkedAt, onCheck, busy }) {

  const stale = isStale(checkedAt);

  return (
    <li className="border-t border-[var(--line)] py-3 first:border-t-0">

      <div className="flex items-baseline justify-between gap-3">
        <a
          href={target.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 text-[0.88rem] font-medium text-ink underline decoration-[var(--line)] underline-offset-4 hover:decoration-ink"
        >
          {target.name}
        </a>
        <span className="shrink-0 text-[0.7rem] text-ink-soft">
          {checkedAt ? ago(checkedAt) : "never checked"}
        </span>
      </div>

      <p className="mt-1 text-[0.76rem] leading-relaxed text-ink-soft">{target.note}</p>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => onCheck(target.slug)}
          disabled={busy}
          className={btn("quiet")}
        >
          {checkedAt ? "Checked again" : "Mark checked"}
        </button>
        {stale && (
          <span className="text-[0.7rem] text-ember">
            {target.kind === "small" ? "worth an email" : "due a look"}
          </span>
        )}
      </div>

    </li>
  );

}


export default function ManualTargets({ checks = {} }) {

  const [state, setState] = useState(checks || {});
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const onCheck = (slug) => {
    const next = { ...state, [slug]: new Date().toISOString() };
    setState(next);
    startTransition(async () => {
      await saveSettingsAction({ manual_checks: next });
    });
  };

  const dueCount = MANUAL_TARGETS.filter(t => isStale(state[t.slug])).length;

  return (
    <Card className="mt-6">

      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <SectionTitle count={dueCount}>Check these yourself</SectionTitle>
        <span aria-hidden="true" className={`text-[0.7rem] text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>

      <p className="mt-1 text-[0.78rem] leading-relaxed text-ink-soft">
        {MANUAL_TARGETS.length} places no feed can reach — the giants behind bot
        protection, and Chicago studios too small to run an applicant system at
        all. The small ones are an advantage: an email lands in a person&rsquo;s
        inbox instead of a pile of ten thousand.
      </p>

      {open && MANUAL_GROUPS.map(group => (
        <div key={group} className="mt-4">
          <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
            {group}
          </div>
          <ul className="mt-1">
            {MANUAL_TARGETS.filter(t => t.group === group).map(t => (
              <Target
                key={t.slug}
                target={t}
                checkedAt={state[t.slug]}
                onCheck={onCheck}
                busy={isPending}
              />
            ))}
          </ul>
        </div>
      ))}

    </Card>
  );

}
