import { ImageResponse } from "next/og";
import { starPosition } from "@/components/launch/fleetMapStars";

// MAP-5: a shareable social card for /launch — the "mission control" constellation as the product's
// most screenshot-worthy surface. The fleet map is per-viewer and an unfurl carries no session, so this
// is a BRANDED, data-free constellation (deterministic phyllotaxis via the real starPosition math),
// not a render of any specific org's fleet — no data leak, no auth needed. A per-fleet snapshot would
// need a signed read-only share token (the heavier alternative noted in the finding).

export const runtime = "nodejs";
export const alt = "Ascent — your engineering fleet, mapped";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
    color: t > 0.66 ? "#22c55e" : t > 0.33 ? "#3b9eff" : "#64748b",
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
          background: "radial-gradient(60rem 40rem at 75% 10%, rgba(59,158,255,0.10), transparent 60%), linear-gradient(160deg, #0b1322 0%, #080d1a 62%)",
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
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                display: "flex",
                width: 44,
                height: 44,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                background: "#3b9eff",
                color: "#04070e",
                fontSize: 30,
                fontWeight: 700,
              }}
            >
              ↑
            </div>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, letterSpacing: 8, color: "#ffffff" }}>ASCENT</div>
          </div>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#3b9eff", fontFamily: "monospace" }}>
            Mission Control
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, color: "#ffffff" }}>
            Your engineering fleet, mapped
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#94a3b8" }}>
            Every org a constellation, every repo a star that brightens with its AI-native maturity.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
