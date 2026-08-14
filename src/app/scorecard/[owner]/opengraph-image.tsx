import { ImageResponse } from "next/og";
import { getPublicOrgScorecard } from "@/lib/register/data";
import { DIMENSION_SHORT, LEVEL_GLYPH, LEVEL_HEX } from "@/lib/ui";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { DimensionId, LevelId } from "@/lib/types";
import {
  Brand,
  SHELL,
  OG_SIZE,
  OG_CONTENT_TYPE,
  FallbackOgCard,
  BRAND_ACCENT,
  BRAND_WHITE,
  BRAND_MUTED,
} from "@/lib/og/og-brand";
import { DIMENSION_COUNT, LEVEL_COUNT } from "@/lib/site";

// Social card for the public org scorecard. Built on the SAME `og-brand` shell as the report and org
// cards (one visual system, one place to change it), and bound by the SAME honesty rule as the page it
// unfurls: a number is drawn only when a model produced one. An owner whose public scans are all
// deterministic previews gets the neutral fallback card — never an aggregate of previews.
//
// No auth check is needed or wanted here (unlike the org-dashboard card, which must gate on
// canReadOrg): `getPublicOrgScorecard` reads the public corpus only, so there is no private aggregate
// this card could disclose even in principle.

export const runtime = "nodejs";
export const alt = "Ascent public AI-native scorecard";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const DIMS: DimensionId[] = DIMENSIONS.map((d) => d.id);

export default async function Image({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  // Drawn at 60px with no wrapping — cap it so a long handle can't overflow the fixed 1200x630 card.
  const displayOwner = owner.length > 28 ? owner.slice(0, 27) + "…" : owner;

  const card = await getPublicOrgScorecard(owner).catch(() => null);

  if (card && card.verifiedCount > 0) {
    const levelId = card.level as LevelId;
    const accent = LEVEL_HEX[levelId] ?? BRAND_ACCENT;
    return new ImageResponse(
      (
        <div style={SHELL}>
          <Brand />

          <div style={{ display: "flex", alignItems: "flex-end", gap: 44 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", color: accent }}>
                <div style={{ display: "flex", fontSize: 168, fontWeight: 700, lineHeight: 1 }}>{card.avgOverall}</div>
                <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: "#64748b" }}>/100</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700, color: accent }}>
                <span>{LEVEL_GLYPH[levelId]}</span>
                <span>
                  {card.level} · {card.levelName}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
              <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: BRAND_ACCENT, fontFamily: "monospace" }}>
                Public scorecard
              </div>
              <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, color: BRAND_WHITE }}>
                {displayOwner}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: BRAND_MUTED }}>
                Adoption {card.avgAdoption} · Rigor {card.avgRigor}, across {card.verifiedCount} model-scored
                public {card.verifiedCount === 1 ? "repo" : "repos"}.
              </div>
            </div>
          </div>

          {/* Dimension strip — the same nine columns the page renders. */}
          <div style={{ display: "flex", gap: 10 }}>
            {DIMS.map((d) => {
              const v = card.dimensions[d];
              return (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 118 }}>
                  <span style={{ display: "flex", fontFamily: "monospace", fontSize: 18, color: BRAND_MUTED }}>
                    {DIMENSION_SHORT[d]}
                  </span>
                  <span style={{ display: "flex", fontFamily: "monospace", fontSize: 30, fontWeight: 700, color: v == null ? "#334155" : BRAND_WHITE }}>
                    {v == null ? "—" : v}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ),
      { ...size },
    );
  }

  // Neutral fallback: no DB, no public scans, or nothing model-scored — never an aggregate of previews.
  return new ImageResponse(
    (
      <FallbackOgCard
        eyebrow="Public scorecard"
        title={displayOwner}
        tagline={`AI-native maturity across ${displayOwner}'s public repositories (a ${LEVEL_COUNT}-level ladder across ${DIMENSION_COUNT} dimensions) with evidence.`}
      />
    ),
    { ...size },
  );
}
