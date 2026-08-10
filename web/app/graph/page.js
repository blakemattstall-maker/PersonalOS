import { backendGet } from "../backend.js";
import GraphCanvas from "./GraphCanvas.js";


export const dynamic = "force-dynamic";


// The graph, whole. The corner button lands here; so do the Connections links
// on project, person and insight cards, which arrive with ?type&id and get
// centred on that thing once the layout settles.
//
// The data is fetched here, server-side, and handed to the canvas as props —
// ~180 nodes serialises to a few tens of KB, and shipping it in the page beats
// a client fetch that would hold the canvas empty for a round trip.
export default async function GraphPage({ searchParams }) {

  const params = await searchParams;

  const data = await backendGet("/api/graph").catch(() => null);

  // A failed fetch (500, a 429 from the limiter, an unauthorized call) has no
  // `nodes` and must NOT render as "nothing is connected yet" — that is the
  // flagship page telling the user their life is empty when really the query
  // died. House rule: a failed query must never look like a quiet week.
  const failed = !data || data.success === false || !Array.isArray(data.nodes);

  const focus = params?.type && params?.id ? `${params.type}:${params.id}` : null;

  return (
    <GraphCanvas
      nodes={data?.nodes || []}
      links={data?.links || []}
      failed={failed}
      focus={focus}
    />
  );

}
