import { nodeRoute } from "../_node.js";
import handler from "./handler.js";

// Public, unauthenticated: strangers on /welcome sign up here. Guarded by a
// rate limit and email validation inside the handler, not by a session.
export const dynamic = "force-dynamic";

export const POST = nodeRoute(handler);
