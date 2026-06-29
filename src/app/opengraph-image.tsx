import { ImageResponse } from "next/og";
import { Brand, SHELL, OG_SIZE, OG_CONTENT_TYPE, BRAND_ACCENT, BRAND_WHITE, BRAND_MUTED } from "@/lib/og/og-brand";
import { DIMENSION_COUNT, LEVEL_COUNT, SITE_TAGLINE, SITE_TAGLINE_TITLE } from "@/lib/site";
import { LEVELS } from "@/lib/maturity/model";

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
          <div style={{ fontSize: 66, fontWeight: 700, lineHeight: 1.08, color: BRAND_WHITE }}>
            {SITE_TAGLINE_TITLE}
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.35, color: BRAND_MUTED }}>
            {`Score any GitHub repo on a ${LEVEL_COUNT}-level ladder across ${DIMENSION_COUNT} dimensions — with evidence and a route to the next level.`}
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
                color: BRAND_ACCENT,
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
