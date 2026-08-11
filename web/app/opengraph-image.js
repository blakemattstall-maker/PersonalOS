import { ImageResponse } from "next/og";


// The card LinkedIn (and every other scraper) renders for a shared link.
// Generated as a real PNG at request time — no binary asset to keep in sync.
//
// Drawn in the site's own language rather than a generic dark card: the paper
// ground (#efeee9), ink display type, a moss eyebrow, and a faint constellation
// in the corner that nods to the connections graph — the product's signature
// surface. Ember never appears (the app reserves it for "waiting on you").

export const runtime = "edge";
export const alt = "Almanac — turn your phone into an executive assistant";
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
          background: "#efeee9",
          color: "#37424a",
          padding: "90px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif"
        }}
      >
        {/* The connections graph, faint, bleeding off the top-right corner —
            the one picture that says what this is. */}
        <svg
          width="520"
          height="520"
          viewBox="0 0 200 200"
          style={{ position: "absolute", top: "-90px", right: "-70px", opacity: 0.55 }}
        >
          <line x1="34" y1="46" x2="96" y2="24" stroke="#b9c0bf" strokeWidth="1.4" />
          <line x1="96" y1="24" x2="156" y2="66" stroke="#b9c0bf" strokeWidth="1.4" />
          <line x1="34" y1="46" x2="66" y2="112" stroke="#b9c0bf" strokeWidth="1.4" />
          <line x1="66" y1="112" x2="132" y2="140" stroke="#b9c0bf" strokeWidth="1.4" />
          <line x1="156" y1="66" x2="132" y2="140" stroke="#b9c0bf" strokeWidth="1.4" />
          <line x1="132" y1="140" x2="182" y2="118" stroke="#b9c0bf" strokeWidth="1.4" />
          <line x1="96" y1="24" x2="66" y2="112" stroke="#b9c0bf" strokeWidth="1.4" />
          <circle cx="34" cy="46" r="6" fill="#4a6b62" />
          <circle cx="96" cy="24" r="9" fill="#4a6b62" />
          <circle cx="156" cy="66" r="6" fill="#b9c0bf" />
          <circle cx="66" cy="112" r="8" fill="#4a6b62" />
          <circle cx="132" cy="140" r="7" fill="#4a6b62" />
          <circle cx="182" cy="118" r="5" fill="#b9c0bf" />
        </svg>

        <div
          style={{
            fontSize: "25px",
            letterSpacing: "6px",
            textTransform: "uppercase",
            color: "#4a6b62",
            fontWeight: 600
          }}
        >
          Turn your phone into an executive assistant
        </div>

        <div style={{ fontSize: "150px", fontWeight: 700, letterSpacing: "-5px", lineHeight: 1, marginTop: "10px" }}>
          Almanac
        </div>

        <div
          style={{
            fontSize: "33px",
            color: "#5e6a70",
            marginTop: "30px",
            maxWidth: "820px",
            lineHeight: 1.42
          }}
        >
          Calendar, tasks, notes, money, people — one system of record that reads across all of it, and speaks up only when it matters.
        </div>
      </div>
    ),
    { ...size }
  );
}
