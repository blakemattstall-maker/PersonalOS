import { nodeRoute } from "../../_node.js";
import handler from "./handler.js";

// Overland posts batches of GPS points here.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const POST = nodeRoute(handler);
export const GET = nodeRoute(handler);
