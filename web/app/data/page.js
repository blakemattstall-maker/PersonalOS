import { formatDate } from "../shared.js";
import DeleteButton from "../DeleteButton.js";
import { backendGet } from "../backend.js";
import Reveal from "../Reveal.js";
import { Page, PageHeader, Card, SectionTitle, Meta } from "../ui.js";


// Every page here reads live state, so none of them may be prerendered.
//
// This was previously implicit: backendGet used fetch(..., { cache: "no-store" }),
// and that opted the route out of static generation as a side effect. Now that
// the same call is a direct in-process function call there is no fetch for Next
// to notice, so without this the page is prerendered at build time and serves
// build-time data until the next deploy. The build output is where this shows
// up — a page marked (Static) that should be (Dynamic).
export const dynamic = "force-dynamic";


async function getData() {

  try {

    return await backendGet("/api/data");

  } catch (error) {

    return { memories: [], notes: [], intentions: [] };

  }

}


function Row({ type, id, primary, secondary }) {

  return (
    <div className="flex items-start justify-between gap-3 border-t border-[var(--line)] py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-[0.87rem] leading-relaxed text-ink">{primary}</p>
        {secondary && <Meta className="mt-1 block">{secondary}</Meta>}
      </div>
      <DeleteButton type={type} id={id} />
    </div>
  );

}


function Group({ title, items, empty, children }) {

  return (
    <div className="pos-reveal" data-reveal>
    <Card className="mb-4">
      <SectionTitle count={items.length}>{title}</SectionTitle>
      {items.length === 0
        ? <p className="text-[0.85rem] text-ink-soft">{empty}</p>
        : <div>{children}</div>}
    </Card>
    </div>
  );

}


export default async function DataPage() {

  const { memories = [], notes = [], intentions = [] } = await getData();

  return (
    <Page>

      <Reveal gap={70}>

      <div className="pos-reveal" data-reveal>
        <PageHeader title="What it knows">
          Everything the app has saved about you. Delete anything that&apos;s
          wrong, out of date, or filed in the wrong place — it stops being used
          immediately.
        </PageHeader>
      </div>

      <Group title="Memories" items={memories} empty="Nothing saved yet.">
        {memories.map(m => (
          <Row
            key={m.id}
            type="memory"
            id={m.id}
            primary={m.content}
            secondary={`${m.type} · importance ${m.importance} · ${formatDate(m.created_at)}`}
          />
        ))}
      </Group>

      <Group title="Notes" items={notes} empty="Nothing saved yet.">
        {notes.map(n => (
          <Row
            key={n.id}
            type="note"
            id={n.id}
            primary={n.content}
            secondary={formatDate(n.created_at)}
          />
        ))}
      </Group>

      <Group title="Intentions" items={intentions} empty="Nothing saved yet.">
        {intentions.map(i => (
          <Row
            key={i.id}
            type="intention"
            id={i.id}
            primary={i.content}
            secondary={`${i.status} · ${formatDate(i.created_at)}`}
          />
        ))}
      </Group>

      </Reveal>

    </Page>
  );

}
