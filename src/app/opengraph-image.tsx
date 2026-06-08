import { ImageResponse } from "next/og";

// Default social card for the site (homepage + any route without its own opengraph-image). Pages
// set `twitter: { card: "summary_large_image" }` in metadata, so without an image their shares
// unfurl blank — this is the fallback that keeps every link rich. Rendered with next/og's built-in
// fonts (no external fetch) so it can't fail at build/request time.

export const alt = "Ascent — the maturity index for AI-native engineering";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(160deg, #0b1322 0%, #080d1a 62%)",
          color: "#e2e8f0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              width: 48,
              height: 48,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              background: "#3b9eff",
              color: "#04070e",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            ↑
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 10, color: "#ffffff" }}>
            ASCENT
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.08, color: "#ffffff" }}>
            The maturity index for AI-native engineering
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.35, color: "#94a3b8" }}>
            Score any GitHub repo on a 5-level ladder across 9 dimensions — with evidence and a route
            to the next level.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {["L0", "L1", "L2", "L3", "L4"].map((l) => (
            <div
              key={l}
              style={{
                display: "flex",
                padding: "8px 20px",
                borderRadius: 999,
                border: "1px solid #1e293b",
                color: "#3b9eff",
                fontSize: 26,
                fontFamily: "monospace",
              }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
