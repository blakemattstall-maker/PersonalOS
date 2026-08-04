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


function formatDate(iso) {

  if (!iso) return "";

  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

}


export default async function Home() {

  const brief = await getBrief();

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

          <p className="mt-4 text-muted">
            No reviews pending yet — this section goes live once the deep-thinking workflow is built.
          </p>

        </section>

      </main>
    </div>
  );

}
