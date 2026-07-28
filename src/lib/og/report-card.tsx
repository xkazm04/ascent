// The per-repo maturity CARD — the 1200×630 artwork behind two surfaces (G5-04):
//
//   1. `src/app/report/[owner]/[repo]/opengraph-image.tsx` — the social unfurl (crawler-facing).
//   2. `GET /api/report/share-card?repo=owner/name[@sha]` — the same PNG as a download, for dropping
//      into a slide or a Slack message.
//
// One renderer, two entry points: the backlog asked for a "share card export", and a second renderer
// would have been a second thing to keep honest. This module owns the artwork; each route owns only
// its own access rules and response headers.
//
// LEGIBILITY AT THUMBNAIL SIZE. A share card is read at ~300px wide in a feed or a Slack preview, so
// exactly three things are sized to survive that: the score, the level, and the repo ref. Everything
// else (dimension strip, axis line) is detail for the full-size view.
//
// HONESTY. The card is a PUBLIC artifact that travels detached from its report, so its caveats must be
// ON it, not beside it:
//   - `incomplete` → the number is NOT rendered at all. A 0/100 from a failed ingest is the most
//     misleading thing this file could draw; the card degrades to a plain "scan incomplete" statement.
//   - `engine.provider === "mock"` → a DEMO badge sits beside the brand lockup at a size that survives
//     downscaling, because a deterministic-rubric score presented bare reads as an AI-scored one.
// Private-repo data can't reach here: both callers resolve the owning org through
// `readableOrgForOwner`, which yields PUBLIC_ORG for anyone (including a crawler) without read access,
// so the lookup simply finds nothing.

import type { ScanReport, LevelId } from "@/lib/types";
import { LEVEL_HEX, LEVEL_GLYPH, scoreHex } from "@/lib/ui";
import { isIncompleteReport } from "@/lib/scoring/gate";
import { Brand, SHELL, FallbackOgCard } from "@/lib/og/og-brand";

/** Small uppercase provenance badge — sized to stay readable when the card is scaled to a thumbnail. */
function ProvenanceBadge({ text, hex }: { text: string; hex: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 18px",
        borderRadius: 999,
        border: `2px solid ${hex}`,
        background: `${hex}1f`,
        color: hex,
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: "uppercase",
        fontFamily: "monospace",
      }}
    >
      {text}
    </div>
  );
}

/**
 * The data card for a persisted report. Returns a plain JSX tree for a `next/og` ImageResponse (no
 * hooks, no client state). `sha` is the caller's requested commit, shown as a 7-char eyebrow suffix.
 */
export function ReportShareCard({ report, sha }: { report: ScanReport; sha?: string }) {
  const ref = `${report.repo.owner}/${report.repo.name}`;

  // An incomplete scan has no measurement to show — never draw its renormalized 0/L1 as a score.
  if (isIncompleteReport(report)) {
    return (
      <FallbackOgCard
        eyebrow="Maturity report"
        title={ref}
        tagline="This scan could not be completed — no dimension could be scored, so no maturity result is shown."
      />
    );
  }

  const levelId = report.level.id as LevelId;
  const accent = LEVEL_HEX[levelId] ?? "#3b9eff";
  const isMock = report.engine.provider === "mock";
  const dims = report.dimensions.slice(0, 9);

  return (
    <div style={SHELL}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Brand />
        {isMock && <ProvenanceBadge text="Demo · deterministic rubric" hex="#38bdf8" />}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 44 }}>
        {/* Headline score dial */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "baseline", color: accent }}>
            <div style={{ display: "flex", fontSize: 168, fontWeight: 700, lineHeight: 1 }}>{report.overallScore}</div>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: "#64748b" }}>/100</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700, color: accent }}>
            <span>{LEVEL_GLYPH[levelId]}</span>
            <span>
              {levelId} · {report.level.name}
            </span>
          </div>
        </div>

        {/* Repo + tagline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#3b9eff", fontFamily: "monospace" }}>
            Maturity report{sha ? ` · ${sha.slice(0, 7)}` : ""}
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, color: "#ffffff" }}>{ref}</div>
          <div style={{ display: "flex", fontSize: 26, color: "#94a3b8" }}>
            Adoption {report.adoptionScore} · Rigor {report.rigorScore} —{" "}
            {isMock ? "scored from deterministic signals, no model analysis." : "across 9 dimensions, with evidence."}
          </div>
        </div>
      </div>

      {/* Dimension strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {dims.map((d) => (
          <div
            key={d.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 9,
              border: `1px solid ${scoreHex(d.score)}55`,
              background: `${scoreHex(d.score)}14`,
              fontFamily: "monospace",
              fontSize: 24,
            }}
          >
            <span style={{ color: "#94a3b8" }}>{d.id}</span>
            <span style={{ color: scoreHex(d.score), fontWeight: 700 }}>{d.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The degraded card both entry points fall back to: no DB, private, or never scanned.
 *  The prop is `repoRef`, not `ref` — `ref` is reserved by React and would never arrive as a prop. */
export function ReportShareCardFallback({ repoRef }: { repoRef: string }) {
  return (
    <FallbackOgCard
      eyebrow="Maturity report"
      title={repoRef}
      tagline="AI-native engineering maturity — a 5-level ladder across 9 dimensions, with evidence."
    />
  );
}
