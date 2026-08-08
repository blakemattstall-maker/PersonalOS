"use client";

import { SpendDonut, CategoryBars } from "../MoneyCharts.js";
import { Stage } from "./parts.js";


// The same two components the real money page renders, given a month of
// plausible student spending instead of a live bank feed.
//
// Reusing the components rather than mocking up a picture of them is the
// point: the arcs draw themselves here for exactly the reason they do there,
// the ramp is the same ramp, and if the chart ever breaks it breaks on this
// page too rather than quietly diverging from what the tour promises.
const CATEGORIES = [
  { name: "food",      total: 412.86, share: 31 },
  { name: "transport", total: 268.40, share: 20 },
  { name: "shopping",  total: 203.15, share: 15 },
  { name: "software",  total: 148.94, share: 11 },
  { name: "eating out", total: 137.20, share: 10 },
  { name: "school",    total: 106.50, share: 8 },
  { name: "other",     total: 63.72,  share: 5 }
];

const TOTAL = CATEGORIES.reduce((t, c) => t + c.total, 0);


export default function SceneMoney() {

  return (
    <Stage minH="min-h-[30rem]">

      <p className="pos-data mb-4 text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
        Last 30 days · categorised locally
      </p>

      <SpendDonut categories={CATEGORIES} total={TOTAL} />

      <div className="mt-7 border-t border-[var(--line)] pt-5">
        <p className="pos-data mb-3 text-[0.68rem] uppercase tracking-[0.12em] text-ink-soft">
          Ranked
        </p>
        <CategoryBars categories={CATEGORIES} max={CATEGORIES[0].total} />
      </div>

      <p className="mt-5 text-[0.82rem] leading-relaxed text-ink-soft">
        Illustrative figures. On the real page these come from one bank call
        every twelve hours, sliced locally — and the transactions behind them
        are the same rows the graph two sections up is linking to projects.
      </p>

    </Stage>
  );

}
