import { backendGet } from "../backend.js";
import { Page, PageHeader } from "../ui.js";
import GraphView from "./GraphView.js";


export const dynamic = "force-dynamic";


// Deliberately not a tab.
//
// The bar already holds six destinations and a seventh crowds it, but the real
// argument is the one the tab bar itself already makes about History and Manage
// data: they are "reached from where you'd actually want them". Nobody opens an
// app wanting *the graph*. They want to know what a project touches, or why the
// system said something. So this is reached from a project, a person, or an
// insight — and each of those arrives here already centred on the thing that
// was being looked at.
async function load(focus) {

  const [anchors, initial] = await Promise.all([

    backendGet("/api/graph")
      .then(result => result.anchors || [])
      .catch(() => []),

    focus?.type && focus?.id
      ? backendGet(`/api/graph?type=${encodeURIComponent(focus.type)}&id=${encodeURIComponent(focus.id)}`)
          .catch(() => null)
      : null

  ]);

  return {
    anchors,
    // A deep link to something that has since been deleted lands on the picker
    // rather than on an error — the same dangling-edge posture the graph layer
    // takes everywhere else.
    initial: initial?.root ? initial : null
  };

}


export default async function GraphPage({ searchParams }) {

  const params = await searchParams;

  const { anchors, initial } = await load({ type: params?.type, id: params?.id });

  return (
    <Page>

      <PageHeader title="Connections">
        What the system has worked out is related, and how. Nothing here was
        tagged by hand — every link is a name that actually appeared in
        something you wrote, or a fact the data already carried.
      </PageHeader>

      <GraphView anchors={anchors} initial={initial} />

    </Page>
  );

}
