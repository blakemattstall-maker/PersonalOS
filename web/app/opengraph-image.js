import { ImageResponse } from "next/og";


// The card LinkedIn (and every other scraper) renders for a shared link.
// Generated as a real PNG at request time — no binary asset to keep in sync —
// in the app's own palette: deep-ink sky, a paper disc rising over a moss
// horizon, the wordmark and the one-line promise. Mirrors the app icon on
// purpose, so the link preview and the installed icon read as one thing.

export const runtime = "edge";
export const alt = "Almanac — a quiet system of record for your whole life";
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
          background: "#2f373d",
          color: "#efeee9",
          padding: "84px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif"
        }}
      >
        {/* the disc */}
        <div
          style={{
            position: "absolute",
            right: "110px",
            top: "120px",
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            background: "#efeee9"
          }}
        />
        {/* the horizon */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "210px",
            background: "#4a6b62",
            display: "flex"
          }}
        />

        <div style={{ fontSize: "128px", fontWeight: 700, letterSpacing: "-3px" }}>
          Almanac
        </div>
        <div
          style={{
            fontSize: "36px",
            color: "#c7ccca",
            marginTop: "18px",
            maxWidth: "720px",
            lineHeight: 1.35
          }}
        >
          A quiet system of record for your whole life — and a mind that reads across all of it.
        </div>
      </div>
    ),
    { ...size }
  );
}
