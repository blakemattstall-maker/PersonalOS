import { nodeRoute } from "../_node.js";
import handler from "./handler.js";

// Every dashboard read and write. Also reachable in-process — see app/backend.js,
// which calls the same handler directly rather than over HTTP.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const GET = nodeRoute(handler);
export const POST = nodeRoute(handler);
