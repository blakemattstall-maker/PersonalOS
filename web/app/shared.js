export function formatDate(iso) {

  if (!iso) return "";

  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

}


export function parseThought(content) {

  try {

    const parsed = JSON.parse(content);

    if (parsed && typeof parsed === "object" && parsed.verdict) {
      return parsed;
    }

    return null;

  } catch (error) {

    return null;

  }

}


export function DeepThoughtBody({ content }) {

  const parsed = parseThought(content);

  // Older entries (before structured output) were saved as plain text.
  if (!parsed) {
    return (
      <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed text-ink">
        {content}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">

      {/* Moss, not ember. A verdict is a conclusion the app has already
          reached — the thing still waiting on the user is the reply box further
          down, and that's where the one ember dot on this card lives. */}
      <div className="rounded-item bg-moss-wash px-4 py-3.5">
        <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-moss">
          Verdict
        </div>
        <div className="pos-display mt-1.5 text-[1.05rem] text-ink">{parsed.verdict}</div>
      </div>

      {parsed.reasoning && (
        <p className="leading-relaxed text-ink">{parsed.reasoning}</p>
      )}

      {/* max-lg: the desktop frame keeps the app phone-narrow at lg+, so the
          two-column upgrade must not fire there — see MoneyCharts.js. */}
      {(parsed.pros?.length > 0 || parsed.cons?.length > 0) && (
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:max-lg:grid-cols-2">

          {parsed.pros?.length > 0 && (
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                For
              </div>
              <ul className="mt-1.5 space-y-1.5 text-[0.85rem] leading-snug text-ink">
                {parsed.pros.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-moss" aria-hidden="true">+</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsed.cons?.length > 0 && (
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                Against
              </div>
              <ul className="mt-1.5 space-y-1.5 text-[0.85rem] leading-snug text-ink">
                {parsed.cons.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-ink-soft" aria-hidden="true">−</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      )}

      {parsed.open_questions?.length > 0 && (
        <div className="rounded-item bg-[var(--sunken)] px-4 py-3.5">
          <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
            Worth answering yourself
          </div>
          <ul className="mt-1.5 space-y-1.5 text-[0.85rem] leading-snug text-ink">
            {parsed.open_questions.map((q, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ink-soft" aria-hidden="true">?</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );

}
