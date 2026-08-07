import { nodeRoute } from "../_node.js";
import handler from "./handler.js";

// The spine. Voice or text in, a tool run, a push back out.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const POST = nodeRoute(handler);
export const GET = nodeRoute(handler);
