import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_SESSION } from "../../lib/demo.js";


async function login(formData) {
  "use server";

  const passphrase = formData.get("passphrase");

  // The real passphrase is checked FIRST, always — if someone sets
  // SITE_PASSPHRASE to "demo" the strict-equality branch above this one wins
  // and they get a real session, never a silently degraded one.
  if (passphrase === process.env.SITE_PASSPHRASE) {

    const cookieStore = await cookies();

    cookieStore.set("pos_session", process.env.SITE_PASSPHRASE, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180
    });

    redirect("/");
  }

  // "demo", typed or clicked, opens the fictional dashboard: fixtures for
  // every read, refusal for every write, both enforced in backend.js. A
  // shorter session than the real one — a demo that expires is a demo that
  // gets to make its first impression twice.
  if (String(passphrase || "").trim().toLowerCase() === DEMO_SESSION) {

    const cookieStore = await cookies();

    cookieStore.set("pos_session", DEMO_SESSION, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      // An hour: the length of a demo visit, not a standing pass. The proxy
      // additionally bounces outside arrivals to /welcome, so this only decides
      // how long in-demo navigation keeps working.
      maxAge: 60 * 60
    });

    redirect("/");
  }

  redirect("/login?error=1");
}


export default async function LoginPage({ searchParams }) {

  const params = await searchParams;
  const hasError = params?.error === "1";

  return (
    <div className="flex flex-1 items-center justify-center bg-paper px-6 py-16">
      <form action={login} className="w-full max-w-sm">

        <h1 className="pos-display text-[2.2rem] text-ink">Almanac</h1>

        <p className="mt-2 text-[0.9rem] text-ink-soft">
          Enter your passphrase to continue.
        </p>

        <input
          type="password"
          name="passphrase"
          autoFocus
          required
          aria-label="Passphrase"
          className="mt-6 w-full rounded-item border border-[var(--line)] bg-card px-4 py-3.5 text-ink outline-none placeholder:text-ink-soft focus:border-ink"
          placeholder="Passphrase"
        />

        {hasError && (
          <p className="mt-3 flex items-center gap-2 text-[0.85rem] font-medium text-ember">
            <span className="pos-ember-dot" aria-hidden="true" />
            That wasn&apos;t right. Try again.
          </p>
        )}

        <button
          type="submit"
          className="mt-5 inline-flex w-full items-center justify-center rounded-[var(--r-pill)] bg-ink px-5 py-3.5 text-[0.9rem] font-medium text-paper transition-colors hover:opacity-90"
        >
          Unlock
        </button>

        {/* The invitation, spelled out. The demo passphrase being public is
            the point — what it opens is the fictional dashboard, and what
            keeps that safe lives in backend.js, not in this copy. */}
        <p className="mt-4 text-center text-[0.82rem] text-ink-soft">
          Just looking? The passphrase <span className="pos-data text-ink">demo</span> opens
          a read-only tour with fictional data.
        </p>

        {/* Without this the tour is a one-way door: the only way back from a
            passphrase field you can't fill is the browser's back button. */}
        <p className="mt-5 text-center text-[0.82rem] text-ink-soft">
          <Link
            href="/welcome"
            className="underline decoration-[var(--line)] decoration-1 underline-offset-[3px] transition-colors hover:decoration-[var(--ink)] hover:text-ink"
          >
            Back to the tour
          </Link>
        </p>

      </form>
    </div>
  );

}
