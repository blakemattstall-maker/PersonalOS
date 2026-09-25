import { ImageResponse } from "next/og";


// The card LinkedIn (and every other scraper) renders for a shared link.
// Generated as a real PNG at request time — no binary asset to keep in sync.
//
// Drawn in the site's own language rather than a generic dark card: the paper
// ground (#efeee9), ink display type, a moss eyebrow, and a faint constellation
// in the corner that nods to the connections graph — the product's signature
// surface. Ember never appears (the app reserves it for "waiting on you").

export const runtime = "edge";
export const alt = "Almanac — context for your whole life";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";


export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#080d10",
          color: "#f4f3ed",
          padding: "90px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif"
        }}
      >
        {/* The orbital Almanac mark, large enough to survive a small LinkedIn
            preview while keeping its individual motion-ready primitives. */}
        <svg
          width="520"
          height="520"
          viewBox="0 0 200 200"
          style={{ position: "absolute", top: "-90px", right: "-70px", opacity: 0.55 }}
        >
          <circle cx="100" cy="100" r="76" fill="#10191d" stroke="#28483f" strokeWidth="2" />
          <ellipse cx="100" cy="100" rx="58" ry="27" fill="none" stroke="#8fe0c1" strokeWidth="4" />
          <ellipse cx="100" cy="100" rx="27" ry="58" fill="none" stroke="#8fe0c1" strokeOpacity="0.55" strokeWidth="4" />
          <path d="M48 136c29-12 68-41 103-74" fill="none" stroke="#8fe0c1" strokeOpacity="0.38" strokeWidth="4" />
          <circle cx="100" cy="100" r="14" fill="#f4f3ed" />
          <circle cx="44" cy="100" r="8" fill="#ff754b" />
          <circle cx="137" cy="62" r="8" fill="#ff754b" />
          <circle cx="126" cy="136" r="8" fill="#ff754b" />
        </svg>

        <div
          style={{
            fontSize: "25px",
            letterSpacing: "6px",
            textTransform: "uppercase",
            color: "#8fe0c1",
            fontWeight: 600
          }}
        >
          One request. Your full context.
        </div>

        <div style={{ fontSize: "150px", fontWeight: 700, letterSpacing: "-5px", lineHeight: 1, marginTop: "10px" }}>
          Almanac
        </div>

        <div
          style={{
            fontSize: "33px",
            color: "#92a1a4",
            marginTop: "30px",
            maxWidth: "820px",
            lineHeight: 1.42
          }}
        >
          Research, decisions and finished work across the apps already holding your life.
        </div>
      </div>
    ),
    { ...size }
  );
}
