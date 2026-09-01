"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualPostingAction } from "./actions.js";
import { btn, field } from "./ui.js";


// A role he found himself.
//
// The crawler watches a few hundred boards and will never watch every one. A
// friend forwards a link, a company posts only on LinkedIn, a boutique agency
// has a careers page and no ATS at all — and until now none of those could be
// tracked, which meant the pipeline chart drew the applications the app happened
// to FIND rather than the applications he actually made. For someone applying to
// hundreds, that is the difference between a record and a sample.
//
// Collapsed by default. It is the rarer path, and the feed is what the page is
// for.
export default function AddPosting() {

  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ company: "", title: "", url: "", location: "", deadline: "" });
  const [applied, setApplied] = useState(false);
  const [note, setNote] = useState(null);
  const [isPending, startTransition] = useTransition();

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = (e) => {

    e.preventDefault();

    if (!form.company.trim() || !form.title.trim()) return;

    setNote(null);

    startTransition(async () => {

      const result = await addManualPostingAction({
        company: form.company.trim(),
        title: form.title.trim(),
        url: form.url.trim() || null,
        location: form.location.trim() || null,
        deadline: form.deadline.trim() || null,
        applied
      });

      // Both failure shapes: a deliberate refusal arrives as { success: false },
      // a handler that threw arrives from backend.js as { error } with no
      // success key at all, and testing only one silently treats a 500 as a win.
      if (result?.success === false || result?.error) {
        setNote(result.error || "Couldn't add that.");
        return;
      }

      setForm({ company: "", title: "", url: "", location: "", deadline: "" });
      setApplied(false);
      setNote(result.message || "Added.");
      router.refresh();

    });

  };


  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${btn("quiet")} mt-4`}
      >
        Add one yourself
      </button>
    );
  }


  return (
    <form onSubmit={submit} className="mt-4 rounded-item bg-[var(--sunken)] p-4">

      <p className="mb-3 text-[0.8rem] leading-relaxed text-ink-soft">
        For anything the crawler will never see — a forwarded link, a
        LinkedIn-only posting, a studio with no job board. It lands in the feed
        and the pipeline like any other.
      </p>

      <div className="space-y-2">

        <input
          type="text"
          value={form.company}
          onChange={set("company")}
          placeholder="Company"
          aria-label="Company"
          disabled={isPending}
          className={field()}
          autoFocus
        />

        <input
          type="text"
          value={form.title}
          onChange={set("title")}
          placeholder="Role title"
          aria-label="Role title"
          disabled={isPending}
          className={field()}
        />

        <input
          type="url"
          value={form.url}
          onChange={set("url")}
          placeholder="Link (optional)"
          aria-label="Link to the posting"
          disabled={isPending}
          className={field()}
        />

        <div className="flex gap-2">
          <input
            type="text"
            value={form.location}
            onChange={set("location")}
            placeholder="Location (optional)"
            aria-label="Location"
            disabled={isPending}
            className={field("flex-1")}
          />
          <input
            type="date"
            value={form.deadline}
            onChange={set("deadline")}
            aria-label="Deadline"
            disabled={isPending}
            className={field("w-[10.5rem]")}
          />
        </div>

      </div>

      {/* The common case for a hand-added role is one he has already applied to
          — he is recording it, not planning it. One tap saves a second trip
          through the stage buttons, and it opens the pipeline entry too. */}
      <label className="mt-3 flex items-center gap-2 text-[0.82rem] text-ink">
        <input
          type="checkbox"
          checked={applied}
          onChange={(e) => setApplied(e.target.checked)}
          disabled={isPending}
          className="h-4 w-4 accent-[var(--ember)]"
        />
        I&rsquo;ve already applied to this
      </label>

      {note && (
        <p className="mt-3 text-[0.82rem] leading-relaxed text-moss">{note}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending || !form.company.trim() || !form.title.trim()}
          className={btn("ember", "md")}
        >
          {isPending ? "Adding…" : "Add it"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setNote(null); }}
          disabled={isPending}
          className={btn("quiet")}
        >
          Done
        </button>
      </div>

    </form>
  );

}
