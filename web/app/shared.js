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
      <div className="mt-2 whitespace-pre-wrap text-foreground leading-relaxed">
        {content}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4">

      <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-accent">Verdict</div>
        <div className="mt-1 font-medium text-foreground">{parsed.verdict}</div>
      </div>

      {parsed.reasoning && (
        <p className="text-foreground leading-relaxed">{parsed.reasoning}</p>
      )}

      {(parsed.pros?.length > 0 || parsed.cons?.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

          {parsed.pros?.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Pros</div>
              <ul className="mt-1 space-y-1 text-sm text-foreground">
                {parsed.pros.map((p, i) => <li key={i}>+ {p}</li>)}
              </ul>
            </div>
          )}

          {parsed.cons?.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Cons</div>
              <ul className="mt-1 space-y-1 text-sm text-foreground">
                {parsed.cons.map((c, i) => <li key={i}>− {c}</li>)}
              </ul>
            </div>
          )}

        </div>
      )}

      {parsed.open_questions?.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Worth answering yourself</div>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {parsed.open_questions.map((q, i) => <li key={i}>? {q}</li>)}
          </ul>
        </div>
      )}

    </div>
  );

}
