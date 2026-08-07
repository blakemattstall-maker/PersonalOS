// Shared shape vocabulary.
//
// Before this existed, `rounded-2xl border border-border bg-surface p-6` was
// pasted about twenty times across ten pages, which is why every section of
// the app carried identical visual weight no matter how much it mattered.
// Everything here is presentational and server-safe; interactive components
// import the class helpers (btn, field) rather than the elements.

const KINDS = {
  thought: { label: "Deep thinking", tile: "bg-slate-wash text-ink" },
  nudge:   { label: "Nudge",         tile: "bg-moss-wash text-moss" },
  prompt:  { label: "Noticed",       tile: "bg-ember-wash text-ember" },
  brief:   { label: "Brief",         tile: "bg-slate-wash text-ink-soft" }
};


/* ── Page frame ─────────────────────────────────────────────────────────── */

// pb-32 is not arbitrary: the tab bar is fixed, so without it the last card on
// every page sits underneath the nav and can't be scrolled into view.
export function Page({ children }) {
  return (
    <div className="flex flex-1 flex-col bg-paper">
      <main className="mx-auto w-full max-w-[34rem] flex-1 px-5 pt-8 pb-32">
        {children}
      </main>
    </div>
  );
}


export function PageHeader({ title, children }) {
  return (
    <header className="mb-6">
      <h1 className="pos-display text-[2rem] text-ink">{title}</h1>
      {children && (
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
      )}
    </header>
  );
}


/* ── The widget ─────────────────────────────────────────────────────────── */

export function Card({ children, className = "", tone = "card" }) {
  const bg = tone === "sunken" ? "bg-[var(--sunken)]" : "bg-card shadow-lift";
  return (
    <section className={`rounded-card ${bg} p-5 ${className}`}>{children}</section>
  );
}


// A section title and its count/action on one baseline. The count is set in
// the data face so it reads as a reading rather than as part of the sentence.
export function SectionTitle({ children, count, action }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="pos-display text-[1.05rem] text-ink">
        {children}
        {count > 0 && (
          <span className="pos-data ml-2 text-[0.8rem] font-normal text-ink-soft">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}


/* ── Signature: the ember dot ───────────────────────────────────────────── */

// Orange means one thing in this app and this is it. See globals.css.
//
// The dot is the only thing distinguishing an item that needs a reply from one
// already dealt with, so it can't be purely visual — the label goes to screen
// readers in its place.
export function EmberDot({ className = "" }) {
  return (
    <>
      <span className={`pos-ember-dot shrink-0 ${className}`} aria-hidden="true" />
      <span className="sr-only">Waiting on you</span>
    </>
  );
}


/* ── Item chrome ────────────────────────────────────────────────────────── */

// The rounded icon tile from the reference, doing real work: it says what kind
// of thing this is at a glance, which the old uppercase eyebrow could only do
// by being read.
const GLYPHS = {
  // A thought it worked through on its own.
  thought: (
    <>
      <path d="M9.5 17h5" />
      <path d="M10.5 20h3" />
      <path d="M12 3.5a6 6 0 0 0-3.4 10.9c.25.2.4.5.4.8V17h6v-1.8c0-.3.15-.6.4-.8A6 6 0 0 0 12 3.5z" />
    </>
  ),
  // A push it already sent, or wanted to.
  nudge: (
    <>
      <path d="M6.2 9.5a5.8 5.8 0 1 1 11.6 0c0 3.9 1.5 5.3 1.5 5.3H4.7s1.5-1.4 1.5-5.3z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  // Something it spotted in the passive data and wants confirmed.
  prompt: (
    <>
      <path d="M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  )
};

export function Tile({ kind }) {
  const style = KINDS[kind] || KINDS.brief;
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-tile ${style.tile}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
      >
        {GLYPHS[kind] || GLYPHS.prompt}
      </svg>
    </span>
  );
}


export function kindLabel(kind) {
  return (KINDS[kind] || KINDS.brief).label;
}


// One item in the triage queue. Its own widget rather than a row separated by
// a hairline — three different kinds of thing used to render as one
// undifferentiated list distinguishable only by reading a small grey word.
//
// `waiting` drives the ember dot, and nothing else in the app may.
export function ItemCard({ kind, title, meta, waiting = true, children }) {
  return (
    <article className="rounded-card bg-card p-5 shadow-lift">

      <div className="flex items-center gap-3">
        <Tile kind={kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
              {kindLabel(kind)}
            </span>
            {waiting && <EmberDot />}
          </div>
          {meta && <Meta className="mt-0.5 block">{meta}</Meta>}
        </div>
      </div>

      {title && (
        <h3 className="pos-display mt-3.5 text-[1.15rem] text-ink">{title}</h3>
      )}

      {children}

    </article>
  );
}


// Small, quiet metadata. Never ember — a timestamp is not waiting on anyone.
export function Meta({ children, className = "" }) {
  return (
    <span className={`pos-data text-[0.7rem] text-ink-soft ${className}`}>
      {children}
    </span>
  );
}


export function Divider() {
  return <hr className="my-4 border-0 border-t border-[var(--line)]" />;
}


/* ── Controls ───────────────────────────────────────────────────────────── */

// `ember` is deliberately not the default and is not "primary". It is for
// controls that clear something off Blake's plate. Saving a setting is `solid`.
const BTN = {
  base: "inline-flex items-center justify-center gap-2 rounded-[var(--r-pill)] font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed",
  size: {
    sm: "px-3.5 py-1.5 text-[0.78rem]",
    md: "px-5 py-2.5 text-[0.88rem]"
  },
  tone: {
    solid: "bg-ink text-paper hover:opacity-90",
    ember: "bg-ember text-white hover:opacity-90",
    quiet: "border border-[var(--line)] text-ink-soft hover:border-ink hover:text-ink",
    ghost: "text-ink-soft hover:text-ink",
    danger: "border border-[var(--line)] text-ink-soft hover:border-ember hover:text-ember"
  }
};

export function btn(tone = "quiet", size = "sm") {
  return `${BTN.base} ${BTN.size[size]} ${BTN.tone[tone]}`;
}


// Inline links are underlined rather than coloured. Colour was doing the
// signalling before, and the colour it used was the accent — which is now
// spoken for. An underline is also the stronger affordance of the two.
export function link(extra = "") {
  return `font-medium text-ink underline decoration-[var(--line)] decoration-1 underline-offset-[3px] transition-colors hover:decoration-[var(--ink)] ${extra}`;
}


export function field(extra = "") {
  return `w-full rounded-item border border-[var(--line)] bg-[var(--sunken)] px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft outline-none focus:border-ink disabled:opacity-50 ${extra}`;
}


/* ── Empty states ───────────────────────────────────────────────────────── */

// An empty screen is an invitation to act, so these take an action rather than
// just reporting absence.
export function Empty({ children, action }) {
  return (
    <div className="rounded-item bg-[var(--sunken)] px-4 py-5">
      <p className="text-[0.88rem] leading-relaxed text-ink-soft">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}


/* ── Loading ────────────────────────────────────────────────────────────── */

// Why these exist at all: every page here is force-dynamic, so navigation used
// to hold the old page on screen while the server rendered the new one. The tab
// bar highlighted nothing, nothing moved, and a tap read as ignored — which is
// worse than a slow page, because the natural response is to tap again.
//
// A loading.js in a segment wraps it in a Suspense boundary, so the swap is
// immediate and this streams in behind it. The work takes the same time; the
// app stops looking broken while it happens.
//
// Shaped like the page it is becoming rather than a spinner. A skeleton that
// matches the real layout means nothing jumps when the content lands.
export function Shimmer({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--r-tile)] bg-[var(--sunken)] ${className}`}
      aria-hidden="true"
    />
  );
}


export function SkeletonCard({ lines = 3 }) {
  return (
    <section className="rounded-card bg-card p-5 shadow-lift">
      <Shimmer className="h-4 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Shimmer key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </section>
  );
}


// `aria-busy` plus a polite live region, so this is announced as loading rather
// than as a page that has simply gone blank.
export function SkeletonPage({ title = null, cards = 3, lines = 3 }) {
  return (
    <Page>
      <div role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        {title
          ? <h1 className="pos-display mb-6 text-[2rem] text-ink">{title}</h1>
          : <Shimmer className="mb-6 h-9 w-1/2" />}
        <div className="space-y-3">
          {Array.from({ length: cards }).map((_, i) => (
            <SkeletonCard key={i} lines={lines} />
          ))}
        </div>
      </div>
    </Page>
  );
}
