import { nodeRoute } from "../../_node.js";
import handler from "../../[resource]/handler.js";

// /api/brief/latest is two segments, so the [resource] route cannot match it.
// The old deployment solved that with a rewrite in vercel.json; here the same
// handler is simply invoked with the resource it would have been rewritten to.
// The URL must not change — the iOS Shortcut has it hardcoded.
export const dynamic = "force-dynamic";

const withResource = (req, res) => handler({ ...req, query: { ...req.query, resource: "brief" } }, res);

export const GET = nodeRoute(withResource);
