import { nodeRoute } from "../_node.js";
import handler from "./handler.js";

// The spine. Voice or text in, a tool run, a push back out.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const run = nodeRoute(handler);


// The desk device's spoken exchange, told apart by its body: raw audio
// instead of JSON. It gets a streaming framed response (see
// lib/deskConverse.js) rather than the buffered JSON reply, because a person
// is standing in front of the speaker while this runs — the phone Shortcut
// and the dashboard keep the JSON path below, untouched.
//
// Intercepted here rather than given its own route file for the same reason
// the desk's PNG is: on Vercel Hobby a new route is a new serverless
// function against a cap this project is already pressed against.
export async function POST(request, context) {

  const contentType = request.headers.get("content-type") || "";

  if (contentType.startsWith("audio/")) {

    // Same dormant-until-set secret as every other device call.
    const configured = process.env.API_SECRET;

    if (configured && request.headers.get("x-pos-key") !== configured) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rateLimit } = await import("../../../lib/ratelimit.js");

    if (!rateLimit("capture:desk-stream", 30).ok) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }

    // Dynamic for the same two reasons as the screen renderer: the module
    // graph behind it (Satori, the tool registry) is heavy, and no phone
    // capture should pay to load it.
    const { deskConverse } = await import("../../../lib/deskConverse.js");

    const audio = Buffer.from(await request.arrayBuffer());

    if (audio.length < 100) {
      return Response.json({ error: "Empty recording" }, { status: 400 });
    }

    return deskConverse({
      audio,
      mime: contentType.split(";")[0],
      // The device owns its own state; the renderer only draws it.
      device: {
        mic: request.headers.get("x-desk-mic") === "off" ? "off" : "on",
        asks: Math.max(0, Math.min(99, Number(request.headers.get("x-desk-asks")) || 0)),
        tts: request.headers.get("x-desk-tts") !== "off"
      }
    });

  }

  return run(request, context);

}


export const GET = run;
