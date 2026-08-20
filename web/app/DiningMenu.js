"use client";

import { useState } from "react";
import { Card, Empty } from "./ui.js";


// The day's menus: a meal switcher, then one card per station with its items,
// each item opening into a full nutrition label.
//
// Nothing in here carries `data-reveal`, deliberately: revealChildren() in
// motion.js collects its targets once on mount, and this component swaps whole
// subtrees when the meal changes — a late-added .pos-reveal node would simply
// stay at opacity 0. The menu doesn't need entrance choreography anyway; the
// one place this page is allowed to be loud is the label.


// Trait icons mix diet identity with allergens. These are the diet ones — they
// belong on the row, where someone scanning for "what can I actually eat"
// needs them. Everything else the icons say is allergen information, which
// lives in the opened label next to the authoritative "Contains:" line.
const DIET_TRAITS = new Set([
  "Vegan", "Vegetarian", "Halal", "Kosher", "Plant Based", "Avoiding Gluten"
]);


const dash = "—";

const grams = (value) => value == null ? dash : `${Math.round(value * 10) / 10}g`;
const milligrams = (value) => value == null ? dash : `${Math.round(value)}mg`;
const percent = (value) => value == null ? "" : `${Math.round(value)}%`;


function MealSwitcher({ meals, active, onPick }) {

  if (meals.length < 2) return null;

  return (
    <div className="mb-5 flex gap-1 self-start rounded-[var(--r-pill)] border border-[var(--line)] p-1">
      {meals.map(({ meal }) => (
        <button
          key={meal}
          type="button"
          onClick={() => onPick(meal)}
          aria-pressed={active === meal}
          className={`rounded-[var(--r-pill)] px-3.5 py-1.5 text-[0.78rem] font-medium transition-colors ${
            active === meal ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
          }`}
        >
          {meal}
        </button>
      ))}
    </div>
  );

}


// One nutrient line of the facts panel. `indent` marks the sub-nutrients
// (saturated fat under total fat), exactly as the printed label does — that
// indentation is regulatory structure, not styling.
function FactRow({ label, value, dv, indent = false, bold = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-t border-[var(--line)] py-1 ${indent ? "pl-4" : ""}`}>
      <span className={`text-[0.78rem] ${bold ? "font-semibold text-ink" : "text-ink-soft"}`}>
        {label} <span className="pos-data text-ink">{value}</span>
      </span>
      <span className="pos-data text-[0.78rem] text-ink">{dv ? percent(dv) : ""}</span>
    </div>
  );
}


// The signature of this page: the item's label, set the way the printed FDA
// panel is set — heavy rules, one huge calorie reading, a %DV column — but in
// this app's ink and mono. The hierarchy is the label's own; only the
// materials changed.
function NutritionLabel({ item }) {

  const n = item.nutrition;

  if (!n) {
    return (
      <p className="pb-3 text-[0.8rem] text-ink-soft">
        The dining hall published no label for this item.
      </p>
    );
  }

  const secondary = [
    ["Vit A", n.vitamin_a_dv], ["Vit C", n.vitamin_c_dv],
    ["Calcium", n.calcium_dv], ["Iron", n.iron_dv]
  ].filter(([, value]) => value != null);

  return (
    <div className="mb-3">

      <div className="rounded-[var(--r-tile)] border border-[var(--line)] bg-[var(--sunken)] px-4 py-3">

        <div className="pos-display text-[1rem] text-ink">Nutrition Facts</div>

        {item.serving && (
          <div className="mt-0.5 text-[0.75rem] text-ink-soft">
            Serving size <span className="pos-data text-ink">{item.serving}</span>
          </div>
        )}

        <div className="mt-2 flex items-baseline justify-between border-t-4 border-ink pt-1.5">
          <span className="text-[0.82rem] font-semibold text-ink">Calories</span>
          <span className="pos-data text-[1.7rem] leading-none text-ink">
            {n.calories == null ? dash : Math.round(n.calories)}
          </span>
        </div>

        <div className="mt-2 border-t-2 border-ink pt-1 text-right text-[0.65rem] text-ink-soft">
          % Daily Value*
        </div>

        <FactRow bold label="Total Fat" value={grams(n.fat_g)} dv={n.fat_dv} />
        <FactRow indent label="Saturated Fat" value={grams(n.sat_fat_g)} dv={n.sat_fat_dv} />
        <FactRow indent label="Trans Fat" value={grams(n.trans_fat_g)} />
        <FactRow bold label="Cholesterol" value={milligrams(n.cholesterol_mg)} dv={n.cholesterol_dv} />
        <FactRow bold label="Sodium" value={milligrams(n.sodium_mg)} dv={n.sodium_dv} />
        <FactRow bold label="Total Carbohydrate" value={grams(n.carbs_g)} dv={n.carbs_dv} />
        <FactRow indent label="Dietary Fiber" value={grams(n.fiber_g)} dv={n.fiber_dv} />
        <FactRow indent label="Sugars" value={grams(n.sugars_g)} />
        <FactRow bold label="Protein" value={grams(n.protein_g)} dv={n.protein_dv} />

        {secondary.length > 0 && (
          <div className="mt-1 border-t-2 border-ink pt-1.5 text-[0.7rem] text-ink-soft">
            {secondary.map(([label, value], i) => (
              <span key={label}>
                {i > 0 && " · "}
                {label} <span className="pos-data text-ink">{percent(value)}</span>
              </span>
            ))}
          </div>
        )}

      </div>

      {item.allergens?.length > 0 && (
        <p className="mt-2 text-[0.78rem] text-ink">
          <span className="font-semibold">Contains:</span> {item.allergens.join(", ")}
        </p>
      )}

      {item.ingredients && (
        <p className="mt-1.5 text-[0.68rem] leading-relaxed text-ink-soft">
          <span className="font-medium">Ingredients:</span> {item.ingredients}
        </p>
      )}

    </div>
  );

}


function MenuItem({ item }) {

  const [open, setOpen] = useState(false);

  const diet = (item.traits || []).filter(t => DIET_TRAITS.has(t));

  const meta = [item.serving, ...diet].filter(Boolean).join(" · ");

  return (
    <li className="border-t border-[var(--line)] first:border-t-0">

      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[0.88rem] leading-snug text-ink">{item.name}</span>
          {meta && (
            <span className="mt-0.5 block text-[0.72rem] text-ink-soft">{meta}</span>
          )}
        </span>
        <span className="pos-data shrink-0 text-[0.85rem] text-ink">
          {item.nutrition?.calories == null ? dash : Math.round(item.nutrition.calories)}
          <span className="ml-1 text-[0.62rem] text-ink-soft">cal</span>
        </span>
      </button>

      {open && <NutritionLabel item={item} />}

    </li>
  );

}


function StationCard({ station }) {

  // Items arrive course-grouped from the sync (Entrees, Sides, Soup…). The
  // eyebrow only appears when a station actually has more than one course —
  // "Entrees" over a station that is nothing but entrees is noise.
  const courses = [];

  for (const item of station.items) {
    const last = courses[courses.length - 1];
    if (!last || last.course !== item.course) {
      courses.push({ course: item.course, items: [item] });
    } else {
      last.items.push(item);
    }
  }

  const showCourses = courses.length > 1;

  return (
    <Card className="mb-3">

      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="pos-display text-[1.02rem] text-ink">
          {station.station}
          {station.allDay && (
            <span className="ml-2 text-[0.68rem] font-normal text-ink-soft">All day</span>
          )}
        </h2>
        <span className="pos-data text-[0.78rem] text-ink-soft">{station.items.length}</span>
      </div>

      {courses.map(group => (
        <div key={group.course || "all"}>
          {showCourses && group.course && (
            <div className="mt-2 text-[0.7rem] font-medium text-ink-soft">{group.course}</div>
          )}
          <ul>
            {group.items.map(item => (
              <MenuItem key={`${item.recipe || item.name}|${item.serving}`} item={item} />
            ))}
          </ul>
        </div>
      ))}

    </Card>
  );

}


export default function DiningMenu({ meals, suggestedMeal }) {

  const [active, setActive] = useState(
    meals.some(m => m.meal === suggestedMeal) ? suggestedMeal : meals[0]?.meal
  );

  const current = meals.find(m => m.meal === active) || meals[0];

  if (!current) {
    return (
      <Empty>
        No menu is published for this day yet. The dining hall usually posts
        about two weeks ahead — check back after tonight's sync.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col">

      <MealSwitcher meals={meals} active={active} onPick={setActive} />

      {current.stations.map(station => (
        <StationCard key={station.station} station={station} />
      ))}

    </div>
  );

}
