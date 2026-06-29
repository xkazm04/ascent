import { ImageResponse } from "next/og";
import { Brand, SHELL, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/og-brand";
import { DIMENSION_COUNT, LEVEL_COUNT, SITE_TAGLINE, SITE_TAGLINE_TITLE } from "@/lib/site";

// Default social card for the site (homepage + any route without its own opengraph-image). Pages
// set `twitter: { card: "summary_large_image" }` in metadata, so without an image their shares
// unfurl blank — this is the fallback that keeps every link rich. Rendered with next/og's built-in
// fonts (no external fetch) so it can't fail at build/request time.

export const alt = `Ascent — ${SITE_TAGLINE}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={SHELL}>
        <Brand />

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.08, color: "#ffffff" }}>
            {SITE_TAGLINE_TITLE}
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.35, color: "#94a3b8" }}>
            {`Score any GitHub repo on a ${LEVEL_COUNT}-level ladder across ${DIMENSION_COUNT} dimensions — with evidence and a route to the next level.`}
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
