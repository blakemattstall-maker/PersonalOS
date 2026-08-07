import { nodeRoute } from "../../../_node.js";
import handler from "./handler.js";

// The OAuth dance. Google redirects a browser to /callback, so this must stay
// reachable without the passphrase — see the matcher in proxy.js.
export const dynamic = "force-dynamic";

export const GET = nodeRoute(handler);
