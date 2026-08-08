import { backendGet } from "../backend.js";
import PersonCard from "../PersonCard.js";
import AddPersonForm from "../AddPersonForm.js";
import Reveal from "../Reveal.js";
import { Page, PageHeader, Empty } from "../ui.js";


export const dynamic = "force-dynamic";


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


export default async function People() {

  const data = await safeGet("/api/people", { success: false, people: [] });
  const people = data.people || [];

  return (
    <Page>

      <Reveal gap={70}>

      <div className="pos-reveal" data-reveal>
        <PageHeader title="People">
          Save someone once and the rest of the app can use it — a birthday
          becomes a recurring reminder, a check-in cadence brings a nudge when
          you&apos;ve gone quiet.
        </PageHeader>
      </div>

      <div className="pos-reveal mb-6" data-reveal>
        <AddPersonForm />
      </div>

      {data.success === false ? (
        <div className="pos-reveal" data-reveal>
          <Empty>
            Couldn&apos;t reach the backend, so this list may be incomplete.
            Pull to refresh, or check Settings for what&apos;s down.
          </Empty>
        </div>
      ) : people.length === 0 ? (
        <div className="pos-reveal" data-reveal>
          <Empty>
            No one saved yet. Add the people you actually want to stay in touch
            with — the app will handle the remembering.
          </Empty>
        </div>
      ) : (
        <div className="space-y-3">
          {people.map(p => (
            <div key={p.id} className="pos-reveal" data-reveal>
              <PersonCard person={p} />
            </div>
          ))}
        </div>
      )}

      </Reveal>

    </Page>
  );

}
