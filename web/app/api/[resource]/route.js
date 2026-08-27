import { nodeRoute } from "../_node.js";
import handler from "./handler.js";

// Every dashboard read and write. Also reachable in-process — see app/backend.js,
// which calls the same handler directly rather than over HTTP.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const run = nodeRoute(handler);


// One exception to "everything goes through the node handler": the desk
// device's screen is a PNG, and the adapter in _node.js only speaks JSON and
// text — deliberately, since binary was never needed until a display existed.
//
// Rather than widen that adapter (or add a route file, which on Vercel Hobby
// means another serverless function against a cap this project is already
// pressed against), the image is intercepted here and served straight as the
// Response that ImageResponse already is.
export async function GET(request, context) {

  const { resource } = await (context?.params ?? Promise.resolve({}));

  if (resource === "desk" && new URL(request.url).searchParams.has("screen")) {

    // Same shared secret as every other device call. Dormant when unset,
    // matching lib/auth.js — enforcement switches on with the env var, not
    // with a redeploy.
    const configured = process.env.API_SECRET;

    if (configured && request.headers.get("x-pos-key") !== configured) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Imported here rather than at the top for two reasons: it is JSX, which
    // the contract tests parse with plain Node (they import every route file
    // to check its exports, and a static import would make that a syntax
    // error), and the Satori/resvg bundle behind ImageResponse is heavy
    // enough that no ordinary dashboard call should pay to load it.
    const { renderDeskScreen } = await import("./deskScreen.js");

    const params = new URL(request.url).searchParams;

    return renderDeskScreen({
      preview: params.get("preview"),
      // The device owns the microphone's state; the renderer only draws it.
      mic: params.get("mic") === "off" ? "off" : "on",
      asks: Math.max(0, Math.min(99, Number(params.get("asks")) || 0)),
      tts: params.get("tts") === "off" ? "off" : "on",
      // Set on the fetch right after a tap acted on something — skips the
      // short source cache so the change is visible immediately.
      fresh: params.get("fresh") === "1"
    });

  }

  return run(request, context);

}


export const POST = run;
