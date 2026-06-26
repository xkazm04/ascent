import { ImageResponse } from "next/og";
import { Brand, SHELL, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/og-brand";
import { LEVELS } from "@/lib/maturity/model";

// Default social card for the site (homepage + any route without its own opengraph-image). Pages
// set `twitter: { card: "summary_large_image" }` in metadata, so without an image their shares
// unfurl blank — this is the fallback that keeps every link rich. Rendered with next/og's built-in
// fonts (no external fetch) so it can't fail at build/request time.

export const alt = "Ascent — the maturity index for AI-native engineering";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={SHELL}>
        <Brand />

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
          {/* Derive the chips from the rubric so the card can never disagree with LEVELS (the ladder
              is L1..L5; a hardcoded ["L0".."L4"] invented a non-existent L0 and dropped L5). */}
          {LEVELS.map((lvl) => (
            <div
              key={lvl.id}
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
              {lvl.id}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
