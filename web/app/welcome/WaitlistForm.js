"use client";

import { useState } from "react";


// The waitlist signup. Client-side only — it posts to /api/waitlist and never
// reaches live data itself, so the welcome tour stays prerendered and the
// "nothing here reads data" guarantee holds.
export default function WaitlistForm() {

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [message, setMessage] = useState("");

  async function submit(event) {

    event.preventDefault();

    if (status === "loading") return;

    setStatus("loading");

    try {

      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const data = await res.json().catch(() => ({}));

      if (data.success) {
        setStatus("done");
        setMessage(data.message || "You're on the list.");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong — try again.");
      }

    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server — try again.");
    }

  }

  if (status === "done") {
    return (
      <p className="flex items-center gap-2 text-[0.92rem] font-medium text-[var(--moss)]">
        <span aria-hidden="true">✓</span>
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-[26rem] flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        aria-label="Email address"
        className="min-w-0 flex-1 rounded-[var(--r-pill)] border border-[var(--line)] bg-[var(--sunken)] px-4 py-3 text-[0.9rem] text-ink outline-none placeholder:text-ink-soft focus:border-ink"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="inline-flex items-center justify-center rounded-[var(--r-pill)] border border-[var(--line)] px-5 py-3 text-[0.88rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-60"
      >
        {status === "loading" ? "Adding…" : "Join the waitlist"}
      </button>
      {status === "error" && (
        <p className="w-full text-[0.82rem] text-[var(--ember-ink)] sm:mt-1">{message}</p>
      )}
    </form>
  );

}
