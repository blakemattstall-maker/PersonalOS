import { nodeRoute } from "../../_node.js";
import handler from "./handler.js";

// Vercel Cron issues a GET with an Authorization header.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const GET = nodeRoute(handler);
export const POST = nodeRoute(handler);
