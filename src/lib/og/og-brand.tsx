// Shared Open-Graph brand chrome for the next/og image routes. Every OG route is a self-contained
// `next/og` ImageResponse and had copy-pasted the same 1200×630 SHELL container, the azure "↑" tile +
// ASCENT wordmark lockup, and the brand palette literals — four copies that had already drifted on the
// tile size (48 vs 44px) and the wordmark letter-spacing (10 vs 9 vs 8). This module is the single
// source: the SHELL style object, the palette consts, the route metadata triplet, and a parameterized
// `Brand()` element factory. `next/og` components are plain JSX, so a shared element factory bundles
// fine. Canonical values picked from the org + report cards (the dominant 2-of-4 copy): a 44px tile
// (borderRadius 11, 30px glyph) and a 28px wordmark at letterSpacing 9 — so the root card's tile and
// the launch card's wordmark shift by a few px to the canonical, which is acceptable.

// Brand palette literals, previously hand-repeated in every OG route.
export const BRAND_ACCENT = "#3b9eff"; // azure tile fill / eyebrow
export const BRAND_INK = "#04070e"; // glyph ink on the accent tile
export const BRAND_WHITE = "#ffffff";
export const BRAND_MUTED = "#94a3b8"; // taglines
export const BRAND_TEXT = "#e2e8f0"; // default body color
export const BRAND_GRADIENT = "linear-gradient(160deg, #0b1322 0%, #080d1a 62%)";

/** Route metadata shared by every OG route — Next requires these as named exports per route file. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/** The 1200×630 flex-column card container style, shared by the data + fallback cards. */
export const SHELL = {
  width: "100%" as const,
  height: "100%" as const,
  display: "flex" as const,
  flexDirection: "column" as const,
  justifyContent: "space-between" as const,
  padding: 80,
  background: BRAND_GRADIENT,
  color: BRAND_TEXT,
  fontFamily: "sans-serif",
};

/**
 * The ASCENT brand lockup: the azure rounded "↑" glyph tile + the letter-spaced white wordmark.
 * Returns a plain JSX element (no hooks) so it composes inside any `next/og` ImageResponse tree.
 */
export function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div
        style={{
          display: "flex",
          width: 44,
          height: 44,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_ACCENT,
          color: BRAND_INK,
          fontSize: 30,
          fontWeight: 700,
        }}
      >
        ↑
      </div>
      <div style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: 9, color: BRAND_WHITE }}>ASCENT</div>
    </div>
  );
}

/**
 * The neutral "fallback" OG card body — the brand lockup, an uppercase monospace eyebrow, a 72px white
 * headline, a muted tagline, and the shared footer. Used by every route's degraded (no-data / private /
 * never-scanned) branch; only the eyebrow, title, and tagline vary per route. Returns a plain JSX tree
 * for a `next/og` ImageResponse.
 */
export function FallbackOgCard({ eyebrow, title, tagline }: { eyebrow: string; title: string; tagline: string }) {
  return (
    <div style={SHELL}>
      <Brand />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 4, textTransform: "uppercase", color: BRAND_ACCENT, fontFamily: "monospace" }}>
          {eyebrow}
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05, color: BRAND_WHITE }}>{title}</div>
        <div style={{ display: "flex", fontSize: 30, color: BRAND_MUTED }}>{tagline}</div>
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "#64748b", fontFamily: "monospace" }}>
        ascent · scan → score → route to the next level
      </div>
    </div>
  );
}
