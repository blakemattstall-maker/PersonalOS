async function getBrief() {

  const backendUrl = process.env.BACKEND_URL;

  try {

    const res = await fetch(`${backendUrl}/api/brief/latest?peek=true`, {
      cache: "no-store"
    });

    return await res.json();

  } catch (error) {

    return { success: false, hasBrief: false, error: error.message };

  }

}


async function getPendingDeepThoughts() {

  const backendUrl = process.env.BACKEND_URL;

  try {

    const res = await fetch(`${backendUrl}/api/deepThoughts/pending`, {
      cache: "no-store"
    });

    const data = await res.json();

    return data.thoughts || [];

  } catch (error) {

    return [];

  }

}


function formatDate(iso) {

  if (!iso) return "";

  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

}


function parseThought(content) {

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


function DeepThoughtBody({ content }) {

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


export default async function Home() {

  const [brief, pendingThoughts] = await Promise.all([
    getBrief(),
    getPendingDeepThoughts()
  ]);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">

        <h1 className="text-2xl font-semibold text-foreground">PersonalOS</h1>

        <section className="mt-8 rounded-2xl border border-border bg-surface p-6">

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
              Today's Brief
            </h2>
            {brief.created_at && (
              <span className="text-sm text-muted">{formatDate(brief.created_at)}</span>
            )}
          </div>

          <div className="mt-4 whitespace-pre-wrap text-foreground leading-relaxed">
            {brief.hasBrief
              ? brief.content
              : "Nothing yet today — check back after your morning brief runs."}
          </div>

        </section>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-6">

          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
            Deep Thinking
          </h2>

          {pendingThoughts.length === 0 ? (

            <p className="mt-4 text-muted">
              No reviews pending — ask PersonalOS to think through a decision and it'll show up here.
            </p>

          ) : (

            <div className="mt-4 space-y-8">
              {pendingThoughts.map((thought) => (
                <div key={thought.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                  <h3 className="font-medium text-foreground">{thought.topic}</h3>
                  {thought.status === "thinking" ? (
                    <p className="mt-2 text-muted italic">Still thinking this through…</p>
                  ) : (
                    <DeepThoughtBody content={thought.content} />
                  )}
                </div>
              ))}
            </div>

          )}

        </section>

      </main>
    </div>
  );

}
