import { ImageResponse } from "next/og";
import { buildDeskState } from "../../../lib/deskState.js";


// The desk device's screen, drawn here rather than on the device.
//
// The firmware's first UI was Arduino_GFX's built-in 5x7 bitmap font scaled up
// nine times. That is not a typography problem you can solve on a
// microcontroller: 1-bit glyphs have no anti-aliasing, so every diagonal is a
// staircase and every size is a multiple of five pixels. Meanwhile this
// project already owns a design system, three real typefaces and a renderer
// that speaks CSS.
//
// So the server draws the picture and the device blits it. Three things fall
// out of that, all of them good: the screen gets genuinely anti-aliased type
// in Almanac's own fonts, a UI change ships as a deploy instead of a reflash
// (seconds, not minutes, and no cable), and the same renderer will serve the
// backpack dongle later at a different size — one design, several bodies.
//
// 368x448 is the panel's exact resolution, so the device never scales.

export const SCREEN = { width: 368, height: 448 };


// Satori needs real font binaries; it cannot use a font by name. Google serves
// TTF instead of WOFF2 when the caller looks old enough not to understand
// WOFF2, which is the only reliable way to get a parseable file out of it.
const LEGACY_UA = "Mozilla/5.0 (Windows NT 5.1; rv:6.0) Gecko/20100101 Firefox/6.0";

const fontCache = new Map();

async function font(family, weight) {

  const key = `${family}:${weight}`;

  if (fontCache.has(key)) return fontCache.get(key);

  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
    { headers: { "User-Agent": LEGACY_UA } }
  ).then(r => r.text());

  const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];

  if (!url) throw new Error(`no font file in Google's CSS for ${key}`);

  const data = await fetch(url).then(r => r.arrayBuffer());

  fontCache.set(key, data);

  return data;

}


// Waking hours, the window the timeline spans. Outside it the marker pins to
// an end rather than sliding off the track.
const DAY_START = 7 * 60;
const DAY_END = 23 * 60;
const DAY_SPAN = DAY_END - DAY_START;

const pct = (minute) => Math.max(0, Math.min(1, (minute - DAY_START) / DAY_SPAN)) * 100;


const C = {
  ground: "#000000",
  ink: "#e8e6de",
  inkSoft: "#7c8790",
  line: "#232a30",
  moss: "#8fb3a7",
  ember: "#e07038",
  tide: "#8aabcc"
};


function trim(text, max) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}


// The bottom card: a rule in the accent colour, a label, and one line of
// substance. Whether that accent is ember or moss is the entire difference
// between "something wants you" and "you are clear", which is why the colour
// is passed in rather than decided here.
function Card({ accent, label, body, bodyColor }) {

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeft: `3px solid ${accent}`,
        paddingLeft: 14
      }}
    >

      <div style={{ display: "flex", fontFamily: "Body", fontSize: 12, letterSpacing: 1.4, color: accent }}>
        {label}
      </div>

      {body ? (
        <div style={{ display: "flex", fontSize: 15, lineHeight: 1.4, color: bodyColor, marginTop: 7 }}>
          {body}
        </div>
      ) : null}

    </div>
  );

}


export async function renderDeskScreen({ preview = null } = {}) {

  const state = await buildDeskState();

  // A design hook, not a feature. The ember state is the one that matters
  // most and appears least, so without this the only way to see it laid out
  // is to wait for a real nudge — which means the important half of the
  // screen would only ever be checked in production, by accident. Reachable
  // only with the device key, and it invents nothing beyond the two fields
  // the card reads.
  if (preview === "waiting") {
    state.attention = {
      count: 3,
      nudge: {
        id: "preview",
        message: "Draft the LinkedIn post about the Trifilm internship tonight — three lines is enough."
      }
    };
  }

  const waiting = state.attention.count > 0;

  const nudge = state.attention.nudge?.message || null;

  const next = state.calendar?.next || null;

  const blocks = state.calendar?.blocks || [];

  // Ember is reserved, app-wide, for "something is waiting on you" — so the
  // accent of this whole screen is decided by one number and nothing else.
  const accent = waiting ? C.ember : C.moss;

  let fonts;

  try {

    const [display, body, mono] = await Promise.all([
      font("Bricolage Grotesque", 700),
      font("Inter", 500),
      font("DM Mono", 400)
    ]);

    fonts = [
      { name: "Display", data: display, weight: 700, style: "normal" },
      { name: "Body", data: body, weight: 500, style: "normal" },
      { name: "Mono", data: mono, weight: 400, style: "normal" }
    ];

  } catch (error) {

    // A font CDN having a bad minute must not blank the desk. Next ships a
    // default face; the layout survives, the personality waits for the next
    // poll sixty seconds later.
    console.error("DESK SCREEN fonts unavailable, falling back:", error.message);

    fonts = undefined;

  }


  const label = { fontFamily: "Body", fontSize: 11, letterSpacing: 1.6, color: C.inkSoft };


  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.ground,
          padding: "26px 24px 22px",
          fontFamily: "Body"
        }}
      >

        {/* Date, quiet, above everything. */}
        <div style={{ ...label, display: "flex" }}>{state.clock.date}</div>

        {/* The clock owns the screen. Baseline-aligned meridiem so the
            numerals sit on a line rather than floating in a box. */}
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 6 }}>
          <div
            style={{
              fontFamily: "Display",
              fontSize: 96,
              lineHeight: 1,
              letterSpacing: -3.5,
              color: C.ink
            }}
          >
            {state.clock.time}
          </div>
          <div
            style={{
              fontFamily: "Body",
              fontSize: 22,
              color: C.inkSoft,
              marginLeft: 10,
              marginBottom: 16
            }}
          >
            {state.clock.meridiem}
          </div>
        </div>

        {/* The shape of the day, as one line: the hours you are awake, the
            stretches already spoken for, and where you are inside it. This is
            what the morning brief says in prose, said in a glance instead. */}
        <div
          style={{
            display: "flex",
            position: "relative",
            height: 6,
            marginTop: 20,
            marginBottom: 4,
            background: C.line,
            borderRadius: 3
          }}
        >
          {blocks.map((b, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${pct(b.startMin)}%`,
                width: `${Math.max(1.2, pct(b.endMin) - pct(b.startMin))}%`,
                top: 0,
                height: 6,
                background: C.moss,
                borderRadius: 3
              }}
            />
          ))}
          {/* Now. Bright, thin, and taller than the track so it reads as a
              position rather than another commitment. */}
          <div
            style={{
              position: "absolute",
              left: `${pct(state.clock.nowMin)}%`,
              top: -4,
              width: 2,
              height: 14,
              background: C.ink
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <div style={{ ...label, display: "flex", fontSize: 10 }}>7A</div>
          <div style={{ ...label, display: "flex", fontSize: 10 }}>11P</div>
        </div>

        {/* What is coming.
            Every branch returns ONE column div rather than a fragment: Satori
            flattens fragment children into the parent without carrying the
            parent's flexDirection, so the label, the title and the time all
            laid out in a row and printed on top of each other. */}
        {state.calendar === null ? (

          <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>
            <div style={{ ...label, display: "flex" }}>CALENDAR</div>
            <div style={{ display: "flex", fontSize: 17, color: C.inkSoft, marginTop: 6 }}>
              unreachable
            </div>
          </div>

        ) : next ? (

          <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>

            <div style={{ ...label, display: "flex" }}>NEXT</div>

            <div
              style={{
                display: "flex",
                fontFamily: "Display",
                fontSize: 28,
                color: C.ink,
                marginTop: 8,
                lineHeight: 1.2
              }}
            >
              {trim(next.title, 24)}
            </div>

            <div style={{ display: "flex", marginTop: 8, alignItems: "center" }}>
              <div style={{ display: "flex", fontFamily: "Mono", fontSize: 14, color: C.tide }}>
                {next.startsInMin >= 60
                  ? `in ${Math.floor(next.startsInMin / 60)}h ${next.startsInMin % 60}m`
                  : `in ${next.startsInMin} min`}
              </div>
              <div style={{ display: "flex", fontFamily: "Mono", fontSize: 14, color: C.inkSoft, marginLeft: 12 }}>
                {next.at}
              </div>
            </div>

          </div>

        ) : (

          <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>

            <div style={{ ...label, display: "flex" }}>REST OF TODAY</div>

            <div
              style={{
                display: "flex",
                fontFamily: "Display",
                fontSize: 28,
                color: C.ink,
                marginTop: 8,
                lineHeight: 1.2
              }}
            >
              Nothing scheduled
            </div>

            {state.calendar?.eveningFree && (
              <div style={{ display: "flex", fontFamily: "Mono", fontSize: 14, color: C.moss, marginTop: 8 }}>
                the evening is free
              </div>
            )}

          </div>

        )}

        {/* Everything below is pushed to the bottom, so the card sits on the
            same line every minute regardless of how long the title above ran. */}
        <div style={{ display: "flex", flexGrow: 1 }} />

        {/* One component for both states, not two similar ones. The waiting
            state is the one that matters and the one that renders rarely, so
            it must not be the branch nobody ever looked at — sharing the
            layout means the state I can see proves the state I cannot. */}
        <Card
          accent={accent}
          label={waiting ? `${state.attention.count} WAITING` : "CLEAR"}
          body={waiting ? trim(nudge, 84) : trim(state.brief?.lead, 76)}
          bodyColor={waiting ? C.ink : C.inkSoft}
        />

        {/* The one affordance. Sits under a hairline so it reads as chrome,
            not as another thing demanding attention. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 16,
            paddingTop: 12,
            borderTop: `1px solid ${C.line}`
          }}
        >
          <div style={{ display: "flex", fontSize: 12, color: C.inkSoft }}>hold to talk</div>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 12, color: accent }}>almanac</div>
        </div>

      </div>
    ),
    {
      ...SCREEN,
      fonts,
      // The interaction data rides on the picture rather than arriving in a
      // second request. One fetch means the device can never be showing one
      // moment's screen while holding another moment's nudge id — the tap
      // resolves exactly what the glass is showing, by construction.
      headers: {
        "x-almanac-count": String(state.attention.count),
        "x-almanac-nudge": state.attention.nudge?.id || "",
        "cache-control": "no-store"
      }
    }
  );


  // Buffered into a plain Response so the reply carries a Content-Length
  // instead of being streamed chunked. The device copes with either now, but
  // a known length lets it stop reading the moment the image is complete
  // rather than waiting on the socket, and it makes a truncated transfer
  // detectable instead of merely undecodable.
  const bytes = await image.arrayBuffer();

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.byteLength),
      "x-almanac-count": String(state.attention.count),
      "x-almanac-nudge": state.attention.nudge?.id || "",
      "cache-control": "no-store"
    }
  });

}
