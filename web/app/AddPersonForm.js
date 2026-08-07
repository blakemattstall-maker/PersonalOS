"use client";

import { useState, useTransition } from "react";
import { savePersonAction } from "./actions.js";


const EMPTY = {
  name: "", relationship: "", notes: "", email: "", phone: "",
  check_in_days: "", important_date_month: "", important_date_day: "", important_date_label: ""
};


export default function AddPersonForm() {

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(null);

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = (e) => {

    e.preventDefault();

    if (!form.name.trim()) return;

    setNote(null);

    startTransition(async () => {

      const result = await savePersonAction({
        name: form.name.trim(),
        relationship: form.relationship.trim() || null,
        notes: form.notes.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        check_in_days: form.check_in_days ? Number(form.check_in_days) : null,
        important_date_month: form.important_date_month ? Number(form.important_date_month) : null,
        important_date_day: form.important_date_day ? Number(form.important_date_day) : null,
        important_date_label: form.important_date_label.trim() || null
      });

      if (result?.success) {
        setNote(result.message);
        setForm(EMPTY);
      } else {
        setNote(result?.error || "Couldn't save.");
      }

    });

  };

  return (
    <div className="rounded-card bg-card p-5 shadow-lift">

      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between pos-display text-[1.05rem] text-ink hover:text-ink"
      >
        <span>Add or update someone</span>
        <span className="text-xs normal-case">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (

        <form onSubmit={submit} className="mt-4 space-y-3">

          <p className="text-xs text-ink-soft">
            Saving a name that already exists updates them instead of creating a duplicate.
          </p>

          <input
            type="text"
            placeholder="Name"
            value={form.name}
            onChange={set("name")}
            required
            className="w-full rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
          />

          <input
            type="text"
            placeholder="Relationship — e.g. college friend, coworker"
            value={form.relationship}
            onChange={set("relationship")}
            className="w-full rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
          />

          <textarea
            placeholder="Notes — how you know them, anything worth remembering"
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            className="w-full rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              type="email"
              placeholder="Email (optional)"
              value={form.email}
              onChange={set("email")}
              className="rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
            />
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={form.phone}
              onChange={set("phone")}
              className="rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs text-ink-soft">Check in every</label>
            <select
              value={form.check_in_days}
              onChange={set("check_in_days")}
              className="mt-1 w-full rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
            >
              <option value="">Don&apos;t remind me</option>
              <option value="7">Week</option>
              <option value="14">2 weeks</option>
              <option value="30">Month</option>
              <option value="60">2 months</option>
              <option value="90">3 months</option>
              <option value="180">6 months</option>
              <option value="365">Year</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-ink-soft">Important date (optional — birthday, anniversary)</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <select
                value={form.important_date_month}
                onChange={set("important_date_month")}
                className="rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
              >
                <option value="">Month</option>
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                max="31"
                placeholder="Day"
                value={form.important_date_day}
                onChange={set("important_date_day")}
                className="rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
              />
              <input
                type="text"
                placeholder="Label"
                value={form.important_date_label}
                onChange={set("important_date_label")}
                className="rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50"
              />
            </div>
            {form.important_date_month && form.important_date_day && (
              <p className="mt-1 text-xs text-ink-soft">
                Adds a calendar reminder on the next occurrence — real, on your actual calendar.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isPending || !form.name.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] bg-ink px-5 py-2.5 text-[0.88rem] font-medium text-paper transition-colors hover:opacity-90 disabled:opacity-45 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>

          {note && <p className="text-xs text-ink-soft">{note}</p>}

        </form>

      )}

    </div>
  );

}
