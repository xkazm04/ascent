import { ImageResponse } from "next/og";
import { getOrgRollup } from "@/lib/db";
import { canReadOrg } from "@/lib/authz";
import { levelForScore } from "@/lib/maturity/model";
import { LEVEL_HEX, LEVEL_GLYPH } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { Brand, SHELL, OG_SIZE, OG_CONTENT_TYPE, FallbackOgCard } from "@/lib/og/og-brand";

// SHELL-2: fleet social card for the org dashboard. Mirrors the per-repo report OG. Real numbers are
// drawn ONLY when the org is publicly readable (canReadOrg — true for the shared public org, and for a
// member's own orgs when a session is present). An unfurl carries no cookies, so a private org always
// degrades to the neutral card — the dashboard's own aggregates never leak to an unauthenticated fetch.

export const runtime = "nodejs"; // the rollup lookup uses the Prisma client
export const alt = "Ascent fleet maturity";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const POSTURES: { id: string; label: string }[] = [
  { id: "ai-native", label: "AI-Native" },
  { id: "ungoverned", label: "Fast & Ungoverned" },
  { id: "manual", label: "Solid but Manual" },
  { id: "early", label: "Getting Started" },
];

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const rollup = await (async () => {
    try {
      return (await canReadOrg(slug)) ? await getOrgRollup(slug) : null;
    } catch {
      return null;
    }
  })();

  if (rollup && rollup.repoCount > 0) {
    const levelId = levelForScore(rollup.avgOverall).id as LevelId;
    const accent = LEVEL_HEX[levelId] ?? "#3b9eff";
    const maxPosture = Math.max(1, ...POSTURES.map((p) => rollup.postureCounts[p.id] ?? 0));
    return new ImageResponse(
      (
        <div style={SHELL}>
          <Brand />

          <div style={{ display: "flex", alignItems: "flex-end", gap: 44 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", color: accent }}>
                <div style={{ display: "flex", fontSize: 168, fontWeight: 700, lineHeight: 1 }}>{rollup.avgOverall}</div>
                <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: "#64748b" }}>/100</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700, color: accent }}>
                <span>{LEVEL_GLYPH[levelId]}</span>
                <span>
                  {levelId} · {levelForScore(rollup.avgOverall).name}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
              <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#3b9eff", fontFamily: "monospace" }}>
                Fleet maturity
              </div>
              <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, color: "#ffffff" }}>{slug}</div>
              <div style={{ display: "flex", fontSize: 26, color: "#94a3b8" }}>
                Adoption {rollup.avgAdoption} · Rigor {rollup.avgRigor} — {rollup.scannedCount}/{rollup.repoCount} repos scanned.
              </div>
            </div>
          </div>

          {/* Posture distribution mini-bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {POSTURES.map((p) => {
              const n = rollup.postureCounts[p.id] ?? 0;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: "monospace", fontSize: 22 }}>
                  <span style={{ display: "flex", width: 290, color: "#94a3b8" }}>{p.label}</span>
                  <div style={{ display: "flex", width: 560, height: 14, borderRadius: 7, background: "#1e293b" }}>
                    <div style={{ display: "flex", width: (n / maxPosture) * 560, height: 14, borderRadius: 7, background: "#3b9eff" }} />
                  </div>
                  <span style={{ display: "flex", color: "#cbd5e1" }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      ),
      { ...size },
    );
  }

  // Fallback — neutral card (no DB, private org without a session, or no scans).
  return new ImageResponse(
    (
      <FallbackOgCard
        eyebrow="Fleet maturity"
        title={slug}
        tagline="AI-native engineering maturity across the fleet — a 5-level ladder across 9 dimensions, with evidence."
      />
    ),
    { ...size },
  );
}
