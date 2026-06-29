import { ImageResponse } from "next/og";
import { starPosition } from "@/components/launch/fleetMapStars";
import { Brand, OG_SIZE, OG_CONTENT_TYPE, BRAND_ACCENT, BRAND_WHITE, BRAND_MUTED, BRAND_GRADIENT } from "@/lib/og/og-brand";

// MAP-5: a shareable social card for /launch — the "mission control" constellation as the product's
// most screenshot-worthy surface. The fleet map is per-viewer and an unfurl carries no session, so this
// is a BRANDED, data-free constellation (deterministic phyllotaxis via the real starPosition math),
// not a render of any specific org's fleet — no data leak, no auth needed. A per-fleet snapshot would
// need a signed read-only share token (the heavier alternative noted in the finding).

export const runtime = "nodejs";
export const alt = "Ascent — your engineering fleet, mapped";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// A decorative star field laid out with the same phyllotaxis placement the live map uses.
const BOX = 560;
const ORIGIN_X = 600;
const ORIGIN_Y = 35;
const STARS = Array.from({ length: 64 }, (_, i) => {
  const { cx, cy } = starPosition(i, 64, `ascent-fleet-${i}`);
  const t = ((i * 41) % 100) / 100; // pseudo-maturity for size/colour variety (decorative)
  return {
    x: ORIGIN_X + (cx / 120) * BOX,
    y: ORIGIN_Y + (cy / 120) * BOX,
    r: 3 + t * 9,
    color: t > 0.66 ? "#22c55e" : t > 0.33 ? BRAND_ACCENT : "#64748b",
    opacity: 0.5 + t * 0.5,
  };
});

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          background: `radial-gradient(60rem 40rem at 75% 10%, rgba(59,158,255,0.10), transparent 60%), ${BRAND_GRADIENT}`,
          fontFamily: "sans-serif",
        }}
      >
        {STARS.map((s, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: s.x,
              top: s.y,
              width: s.r * 2,
              height: s.r * 2,
              borderRadius: 9999,
              background: s.color,
              opacity: s.opacity,
            }}
          />
        ))}

        {/* org core beacon */}
        <div style={{ position: "absolute", left: ORIGIN_X + BOX / 2 - 6, top: ORIGIN_Y + BOX / 2 - 6, width: 12, height: 12, borderRadius: 9999, background: "#e2e8f0" }} />

        <div style={{ position: "absolute", left: 80, top: 210, display: "flex", flexDirection: "column", gap: 16, width: 540 }}>
          <Brand />
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: BRAND_ACCENT, fontFamily: "monospace" }}>
            Mission Control
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, color: BRAND_WHITE }}>
            Your engineering fleet, mapped
          </div>
          <div style={{ display: "flex", fontSize: 28, color: BRAND_MUTED }}>
            Every org a constellation, every repo a star that brightens with its AI-native maturity.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
