import { ImageResponse } from "next/og";
import { buildDeskState } from "../../../lib/deskState.js";
import { loadDeskScreen } from "../../../lib/deskScreens.js";


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
// (seconds, not minutes, and no cable), and — the reason it matters most —
// the screen can be composed per question instead of designed in advance.
//
// There are two of them now. The resting face is what the desk looks like
// when nobody is asking: a clock and an eye, deliberately close to empty.
// The answer screen is laid out by the model from the vocabulary in
// lib/deskScreens.js and stands for a couple of minutes before the device
// falls back to resting on its own.
//
// 368x448 is the panel's exact resolution, so the device never scales.

export const SCREEN = { width: 368, height: 448 };


// The word the device is actually listening for.
//
// This lives here because the screen is what tells a person what to say, and
// it went stale the moment the model changed: the firmware was rebuilt around
// Espressif's free wn9_jarvis_tts while this footer still told its owner to
// say "hi E-S-P". The wake word is a firmware fact and a UI string at the
// same time, so the string gets a name and one place to change.
//
// If the model in firmware/almanac-desk/models ever changes again, change
// this with it.
const WAKE_WORD = "Jarvis";


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


const C = {
  ground: "#000000",
  ink: "#e8e6de",
  inkSoft: "#7c8790",
  line: "#232a30",
  moss: "#8fb3a7",
  ember: "#e07038",
  tide: "#8aabcc",
  iris: "#a99bd0",
  good: "#8fb3a7",
  bad: "#e07038"
};

const ACCENT_HEX = { moss: C.moss, ember: C.ember, tide: C.tide, iris: C.iris };


function trim(text, max) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}


const label = (color = C.inkSoft) => ({
  display: "flex",
  fontFamily: "Body",
  fontSize: 11,
  letterSpacing: 1.6,
  color
});


// ---------------------------------------------------------------------------
// The resting face
// ---------------------------------------------------------------------------

// An eye rather than a dashboard.
//
// The first version of this screen showed the clock, the day's timeline, the
// next event, the brief's opening line and the current nudge all at once —
// genuinely useful, and far too much to have sitting on a desk staring at
// you. Resting should be calm and nearly empty; everything it used to show
// is one question away now.
//
// The iris drifts with the minute, which is the only animation a screen
// repainted once a minute can honestly have: over an hour it looks around
// the room instead of staring.
function ClosedEye({ size = 132 }) {

  // A shut eye, not a crossed-out icon. Someone glancing over should be able
  // to tell the microphone is off without knowing what any symbol means, and
  // an eye that is simply closed reads that way instantly.
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          borderRadius: size,
          border: `1px solid ${C.line}`
        }}
      />
      <div style={{ display: "flex", width: size - 52, height: 3, background: C.inkSoft, borderRadius: 3 }} />
    </div>
  );

}


function Eye({ accent, awake }) {

  const minute = new Date().getMinutes();

  // A slow circular wander, never far from centre.
  const angle = (minute / 60) * Math.PI * 2;
  const dx = Math.round(Math.cos(angle) * 9);
  const dy = Math.round(Math.sin(angle) * 6);

  const size = 132;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center"
      }}
    >

      {/* The outer halo: a ring rather than a disc, so the centre stays true
          black and the AMOLED does the glowing. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          borderRadius: size,
          border: `1px solid ${accent}`,
          opacity: 0.28
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 16,
          top: 16,
          width: size - 32,
          height: size - 32,
          borderRadius: size,
          border: `2px solid ${accent}`,
          opacity: 0.55
        }}
      />

      {/* Iris. */}
      <div
        style={{
          position: "absolute",
          left: 40 + dx,
          top: 40 + dy,
          width: size - 80,
          height: size - 80,
          borderRadius: size,
          background: accent,
          opacity: awake ? 0.95 : 0.6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {/* Pupil, so the iris reads as an eye and not a dot. */}
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 16,
            background: C.ground
          }}
        />
      </div>

    </div>
  );

}


function RestingFace({ state, mic, asks }) {

  const waiting = state.attention.count > 0;

  const accent = waiting ? C.ember : C.moss;

  // A column div, never a fragment. Satori flattens fragment children into
  // the parent WITHOUT carrying the parent's flexDirection, so every child
  // lays out in a row — the date, the clock and the eye printed side by side
  // and off the edge of the panel. This is the second time that bug has been
  // built here; it is a container now so it cannot be a third.
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>

      <div style={label()}>{state.clock.date}</div>

      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 4 }}>
        <div
          style={{
            fontFamily: "Display",
            fontSize: 92,
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
            fontSize: 21,
            color: C.inkSoft,
            marginLeft: 10,
            marginBottom: 15
          }}
        >
          {state.clock.meridiem}
        </div>
      </div>

      <div style={{ display: "flex", flexGrow: 1 }} />

      <div style={{ display: "flex", justifyContent: "center" }}>
        {mic === "off" ? <ClosedEye /> : <Eye accent={accent} awake={waiting} />}
      </div>

      <div style={{ display: "flex", flexGrow: 1 }} />

      {/* The microphone's state outranks everything else on this face. It
          lives in a shared room, and someone else's ability to see at a
          glance whether it is listening matters more than the next event. */}
      {mic === "off" ? (
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: "Body", fontSize: 13, letterSpacing: 1.4, color: C.inkSoft }}>
            MIC OFF
          </div>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 12, color: C.line, marginLeft: 10 }}>
            tap to arm
          </div>
        </div>
      ) : waiting ? (
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 8, height: 8, borderRadius: 8, background: C.ember, display: "flex" }} />
          <div style={{ display: "flex", fontFamily: "Body", fontSize: 14, color: C.ember, marginLeft: 10 }}>
            {state.attention.count} waiting
          </div>
        </div>
      ) : state.calendar?.next ? (
        <div style={{ display: "flex", fontFamily: "Mono", fontSize: 13, color: C.inkSoft }}>
          {trim(state.calendar.next.title, 20)} · {state.calendar.next.startsInMin >= 60
            ? `${Math.floor(state.calendar.next.startsInMin / 60)}h`
            : `${state.calendar.next.startsInMin}m`}
        </div>
      ) : (
        <div style={{ display: "flex", fontFamily: "Mono", fontSize: 13, color: C.inkSoft }}>
          nothing scheduled
        </div>
      )}

      {/* Every recording this device has sent today, counted in the open. A
          number that stays at zero all day is the claim "it is not quietly
          uploading" made checkable rather than promised. */}
      {mic !== "off" && (
        <div style={{ display: "flex", fontFamily: "Mono", fontSize: 11, color: C.line, marginTop: 7 }}>
          {asks === 0 ? "nothing sent today" : `${asks} sent today`}
        </div>
      )}

    </div>
  );

}


// ---------------------------------------------------------------------------
// The composed answer
// ---------------------------------------------------------------------------

function Stat({ block, accent }) {

  const tone = block.tone === "good" ? C.good : block.tone === "bad" ? C.bad : accent;

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <div style={{ fontFamily: "Display", fontSize: 62, lineHeight: 1, letterSpacing: -2, color: tone }}>
          {block.value}
        </div>
        {block.unit && (
          <div style={{ fontFamily: "Body", fontSize: 20, color: C.inkSoft, marginLeft: 8, marginBottom: 6 }}>
            {block.unit}
          </div>
        )}
      </div>
      {block.label && (
        <div style={{ display: "flex", fontSize: 14, color: C.inkSoft, marginTop: 6 }}>{block.label}</div>
      )}
    </div>
  );

}


function Bar({ block, accent }) {

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", fontSize: 15, color: C.ink }}>{block.label}</div>
        {block.caption && (
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 12, color: C.inkSoft }}>
            {block.caption}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          position: "relative",
          height: 8,
          marginTop: 8,
          background: C.line,
          borderRadius: 4
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: `${Math.round(block.value * 100)}%`,
            height: 8,
            background: accent,
            borderRadius: 4
          }}
        />
      </div>

    </div>
  );

}


function Rows({ block }) {

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
      {block.items.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "baseline",
            paddingTop: 7,
            paddingBottom: 7,
            borderBottom: i < block.items.length - 1 ? `1px solid ${C.line}` : "none"
          }}
        >
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 13, color: C.inkSoft, width: 74 }}>
            {row[0] || ""}
          </div>
          <div style={{ display: "flex", fontSize: 16, color: C.ink }}>{row[1]}</div>
        </div>
      ))}
    </div>
  );

}


function Chips({ block, accent }) {

  return (
    <div style={{ display: "flex", flexWrap: "wrap", marginTop: 14 }}>
      {block.items.map((item, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            fontFamily: "Mono",
            fontSize: 12,
            color: accent,
            border: `1px solid ${accent}`,
            borderRadius: 99,
            padding: "4px 11px",
            marginRight: 7,
            marginTop: 7
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );

}


function AnswerScreen({ spec }) {

  const accent = ACCENT_HEX[spec.accent] || C.tide;

  // Column container rather than a fragment, for the reason spelled out in
  // RestingFace.
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>

      {spec.eyebrow && <div style={label(accent)}>{spec.eyebrow}</div>}

      {spec.headline && (
        <div
          style={{
            display: "flex",
            fontFamily: "Display",
            fontSize: 27,
            lineHeight: 1.2,
            color: C.ink,
            marginTop: spec.eyebrow ? 9 : 0
          }}
        >
          {spec.headline}
        </div>
      )}

      {(spec.blocks || []).map((block, i) => {
        if (block.kind === "stat") return <Stat key={i} block={block} accent={accent} />;
        if (block.kind === "bar") return <Bar key={i} block={block} accent={accent} />;
        if (block.kind === "rows") return <Rows key={i} block={block} />;
        if (block.kind === "chips") return <Chips key={i} block={block} accent={accent} />;
        return (
          <div key={i} style={{ display: "flex", fontSize: 15, lineHeight: 1.4, color: C.inkSoft, marginTop: 14 }}>
            {block.text}
          </div>
        );
      })}

      <div style={{ display: "flex", flexGrow: 1 }} />

    </div>
  );

}


// ---------------------------------------------------------------------------

export async function renderDeskScreen({ preview = null, mic = "on", asks = 0 } = {}) {

  const [state, answer] = await Promise.all([
    buildDeskState(),
    preview === "resting" ? Promise.resolve(null) : loadDeskScreen().catch(() => null)
  ]);

  if (preview === "waiting") {
    state.attention = { count: 3, nudge: { id: "preview", message: "preview" } };
  }

  const waiting = state.attention.count > 0;

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


  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.ground,
          padding: "26px 24px 20px",
          fontFamily: "Body"
        }}
      >

        {/* The composed screen is allowed to be too tall — a model given a
            rich answer will occasionally ask for more than 448 pixels. It
            gets clipped here rather than shoving the footer off the bottom
            of the glass, which is what happened the first time an answer ran
            long: the "hold to talk" hint simply vanished. */}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, overflow: "hidden" }}>
          {answer ? <AnswerScreen spec={answer.spec} /> : <RestingFace state={state} mic={mic} asks={asks} />}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 12,
            paddingTop: 11,
            flexShrink: 0,
            borderTop: `1px solid ${C.line}`
          }}
        >
          <div style={{ display: "flex", fontSize: 12, color: C.inkSoft }}>
            {mic === "off" ? "microphone off" : answer ? "hold to ask again" : `say \u201c${WAKE_WORD}\u201d or hold`}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Mono",
              fontSize: 12,
              color: waiting ? C.ember : C.moss
            }}
          >
            almanac
          </div>
        </div>

      </div>
    ),
    { ...SCREEN, fonts }
  );


  // Buffered into a plain Response so the reply carries a Content-Length
  // instead of being streamed chunked. The device copes with either now, but
  // a known length lets it stop reading the moment the image is complete
  // rather than waiting on the socket, and it makes a truncated transfer
  // detectable instead of merely undecodable.
  const bytes = await image.arrayBuffer();

  // How long the device should wait before asking again. While an answer is
  // up the screen has a deadline, so it comes back promptly to replace it
  // with the resting face; otherwise a minute is plenty for a clock.
  const nextIn = answer
    ? Math.max(10, Math.ceil((new Date(answer.expiresAt) - Date.now()) / 1000))
    : 60;

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.byteLength),
      "x-almanac-count": String(state.attention.count),
      "x-almanac-nudge": state.attention.nudge?.id || "",
      "x-almanac-next": String(nextIn),
      // Which face is on the glass. The device cannot see inside the PNG it
      // is showing, and what a tap should DO depends entirely on that: on the
      // resting face the middle of the screen is the mute switch, on an
      // answer it is "put this away". Without this the device applied the
      // resting layout's zones to every screen, so dismissing an answer
      // silently muted the microphone instead.
      "x-almanac-view": answer ? "answer" : "resting",
      "cache-control": "no-store"
    }
  });

}
