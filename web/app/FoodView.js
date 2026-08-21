"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import DiningMenu from "./DiningMenu.js";
import ReadAloud from "./ReadAloud.js";
import { Card, Empty, SectionTitle, field, btn } from "./ui.js";
import {
  askDiningAction, planMealsAction, trackMealAction, untrackMealAction
} from "./actions.js";


// The food page's working surface. Plan is the default tab because the page's
// job is deciding and recording what to eat — the menu browser is the
// reference material, one tab over (and the dining hall's own site exists for
// pure reading). Tab state is local: both panes' data arrived with the page,
// so switching costs nothing.


const fmt = (value, suffix = "") =>
  value == null ? "—" : `${Math.round(value).toLocaleString("en-US")}${suffix}`;


function Reading({ label, value, target, suffix = "" }) {
  return (
    <div>
      <div className="text-[0.7rem] text-ink-soft">{label}</div>
      <div className="pos-data mt-0.5 text-[1.35rem] leading-none text-ink">
        {fmt(value, suffix)}
        {target != null && (
          <span className="ml-1.5 text-[0.75rem] text-ink-soft">/ {fmt(target, suffix)}</span>
        )}
      </div>
    </div>
  );
}


function DiningAsk({ date }) {

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();

  const ask = () => {

    if (!question.trim() || isPending) return;

    setError(null);

    const asked = question.trim();

    startTransition(async () => {

      const result = await askDiningAction(asked, date);

      if (result?.success) {
        setAnswer({ question: asked, message: result.message });
        setQuestion("");
      } else {
        setError(result?.message || result?.error || "Couldn't read the menu right now.");
      }

    });

  };

  return (
    <div>

      <div className="flex items-end gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="e.g. best protein at dinner tonight?"
          disabled={isPending}
          aria-label="Ask a question about the menu"
          className={field("flex-1")}
        />
        <button
          onClick={ask}
          disabled={isPending || !question.trim()}
          className={`${btn("ember", "md")} shrink-0`}
        >
          {isPending ? "…" : "Ask"}
        </button>
      </div>

      <p className="mt-2 text-[0.75rem] text-ink-soft">
        Answered from this day&rsquo;s synced menu and your food preferences —
        the same brain the capture shortcut uses.
      </p>

      {error && (
        <p className="mt-3 rounded-item bg-[var(--sunken)] px-3.5 py-2.5 text-[0.85rem] text-ink">
          {error}
        </p>
      )}

      {answer && (
        <div className="mt-3 rounded-item bg-[var(--sunken)] px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.78rem] font-medium text-ink-soft">&ldquo;{answer.question}&rdquo;</p>
            <ReadAloud text={answer.message} title="Dining" />
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink">
            {answer.message}
          </p>
        </div>
      )}

    </div>
  );

}


function PlanButton({ date }) {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(null);

  const plan = () => {

    setNote(null);

    startTransition(async () => {

      const result = await planMealsAction(date);

      // The refreshed planned rows arrive with the page; the message only
      // needs to carry what a list can't — a failure, or "nothing left".
      if (!result?.success) setNote(result?.message || result?.error || "Planning failed.");
      else if (!result?.data?.plans?.length) setNote(result.message);

      router.refresh();

    });

  };

  return (
    <div className="flex items-center gap-2">
      {note && <span className="max-w-[14rem] text-right text-xs text-ink-soft">{note}</span>}
      <button
        onClick={plan}
        disabled={isPending}
        className="inline-flex items-center rounded-[var(--r-pill)] border border-[var(--line)] px-3.5 py-1.5 text-[0.78rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-45"
      >
        {isPending ? "Planning…" : "Plan meals"}
      </button>
    </div>
  );

}


function RemoveButton({ id, label }) {

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(async () => {
        await untrackMealAction(id);
        router.refresh();
      })}
      disabled={isPending}
      aria-label={label}
      className="shrink-0 rounded-full px-2 py-1 text-[0.85rem] leading-none text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
    >
      ×
    </button>
  );

}


function LogEntry({ row, planned = false }) {

  const names = (row.items || [])
    .map(i => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name))
    .join(", ");

  const unknown = (row.items || []).some(i => i.calories == null);

  return (
    <li className="flex items-start justify-between gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0">

      {/* An eaten row is one food now (tools/mealPlan.js logs per item), so
          the FOOD leads and the meal it belonged to is the subtitle — the old
          order read "Lunch — Grill / chicken sandwich" for every line of a
          three-item lunch. Planned rows still carry a whole meal. */}
      <div className="min-w-0">
        <div className="text-[0.85rem] leading-snug text-ink">
          {!planned && names
            ? <span className="font-medium">{names}</span>
            : <><span className="font-medium">{row.meal}</span>
                {row.station && <span className="text-ink-soft"> — {row.station}</span>}</>}
        </div>
        <div className="mt-0.5 text-[0.78rem] leading-relaxed text-ink-soft">
          {!planned && names
            ? [row.meal, row.station].filter(Boolean).join(" · ")
            : names}
        </div>
        {planned && row.note && (
          <div className="mt-0.5 text-[0.72rem] text-ink-soft">{row.note}</div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="pos-data text-[0.82rem] text-ink">
          {row.calories == null ? "—" : Math.round(row.calories)}
          <span className="ml-1 text-[0.6rem] text-ink-soft">cal{unknown ? "*" : ""}</span>
        </span>
        <RemoveButton id={row.id} label={planned ? `Remove the ${row.meal} plan` : `Remove ${names || row.meal} from the log`} />
      </div>

    </li>
  );

}


function PlanPane({ date, today, log, hasMenu }) {

  if (!log?.configured) {
    return (
      <Empty>
        {log?.error || "Meal tracking isn't set up yet — run docs/schema-dining-log.sql in Supabase."}
        {" "}The menu browser still works in the Menu tab.
      </Empty>
    );
  }

  const isToday = date === today;

  return (
    <div className="flex flex-col gap-3">

      <Card>
        <div className="flex items-end justify-between gap-4">
          <Reading label={isToday ? "Eaten today" : `Eaten ${date}`} value={log.totals.calories} target={log.targets.calories} suffix=" cal" />
          <Reading label="Protein" value={log.totals.protein_g} target={log.targets.protein_g} suffix="g" />
          <Reading label="Carbs" value={log.totals.carbs_g} suffix="g" />
          <Reading label="Fat" value={log.totals.fat_g} suffix="g" />
        </div>
        {log.totals.calories == null && (
          <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-soft">
            Nothing tracked {isToday ? "yet today" : "for this day"}. Track from
            the Menu tab, or tell capture what you ate.
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle count={log.planned.length} action={hasMenu ? <PlanButton date={date} /> : null}>
          Planned
        </SectionTitle>
        {log.planned.length === 0 ? (
          <p className="text-[0.82rem] leading-relaxed text-ink-soft">
            {hasMenu
              ? "No plan for this day yet. Plan meals picks plates from the menu around your calendar, preferences and targets, and blocks the time."
              : "No menu is published for this day, so there's nothing to plan from."}
          </p>
        ) : (
          <ul>
            {log.planned.map(row => <LogEntry key={row.id} row={row} planned />)}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle>Ask the menu</SectionTitle>
        <DiningAsk date={date} />
      </Card>

      {log.eaten.length > 0 && (
        <Card>
          <SectionTitle count={log.eaten.length}>Tracked</SectionTitle>
          <ul>
            {log.eaten.map(row => <LogEntry key={row.id} row={row} />)}
          </ul>
          {log.eaten.some(r => (r.items || []).some(i => i.calories == null)) && (
            <p className="mt-2 text-[0.7rem] text-ink-soft">
              * includes items that weren&rsquo;t on the menu, logged without nutrition.
            </p>
          )}
        </Card>
      )}

    </div>
  );

}


export default function FoodView({ date, today, meals, suggestedMeal, log }) {

  const router = useRouter();

  const [tab, setTab] = useState("plan");

  const track = async (item, meal, station) => {

    const n = item.nutrition || {};

    return trackMealAction({
      date,
      meal,
      station,
      items: [{
        name: item.name,
        serving: item.serving,
        station,
        quantity: 1,
        calories: n.calories ?? null,
        protein_g: n.protein_g ?? null,
        carbs_g: n.carbs_g ?? null,
        fat_g: n.fat_g ?? null
      }]
    }).then(result => {
      router.refresh();
      return result;
    });

  };

  return (
    <div className="flex flex-col">

      <div className="mb-5 flex gap-1 self-start rounded-[var(--r-pill)] border border-[var(--line)] p-1">
        {["plan", "menu"].map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-[var(--r-pill)] px-4 py-1.5 text-[0.78rem] font-medium transition-colors ${
              tab === key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {key === "plan" ? "Plan" : "Menu"}
          </button>
        ))}
      </div>

      {tab === "plan" ? (
        <PlanPane date={date} today={today} log={log} hasMenu={meals.length > 0} />
      ) : (
        <DiningMenu
          meals={meals}
          suggestedMeal={suggestedMeal}
          onTrack={log?.configured ? track : null}
        />
      )}

    </div>
  );

}
