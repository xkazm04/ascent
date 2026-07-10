// Board-ready PDF of the executive briefing — the "download a report for the leadership deck"
// artifact (Direction #5 phase 2). Rendered with @react-pdf/renderer (built-in Helvetica, light
// theme) from the same ExecBriefing the /org/[slug]/executive page and the "Copy for LLM" brief use,
// so the page, the clipboard brief, and the PDF can never disagree. Driven by /api/org/briefing/pdf.
// Shares its light-theme scaffolding (palette, scoreColor, base styles, Stat, Footer) with
// report-document.tsx + security-document.tsx via ./theme.

import { Document, Page, Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { engineMixDegraded, engineMixLabel, forecastConfidenceNote } from "@/lib/org/briefing";
import type { BriefingDim, BriefingMove, ExecBriefing } from "@/lib/org/briefing";
import { ACCENT, INK, MUTED, FAINT, baseStyles, scoreColor, Stat, Footer } from "./theme";

/** EXEC-5 white-label: an org's brand overrides the Ascent defaults in the PDF. All optional. */
export interface BriefingBranding {
  brandName: string | null;
  brandColor: string | null;
  logoUrl: string | null;
}

const sgn = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

const styles = StyleSheet.create({
  line: { marginTop: 10, color: MUTED },
  traj: { marginTop: 4, color: INK, fontFamily: "Helvetica-Bold" },
  twoCol: { flexDirection: "row", gap: 24 },
  col: { width: "50%", flexDirection: "column" },
  dimRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  moveRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  goalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  goalLabel: { color: INK },
});

function DimLine({ d }: { d: BriefingDim }) {
  return (
    <View style={styles.dimRow}>
      <Text>{d.dimId} · {d.label}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold", color: scoreColor(d.avg) }}>{d.avg}/100</Text>
    </View>
  );
}

function MoveLine({ tone, m }: { tone: "up" | "down"; m: BriefingMove }) {
  const color = tone === "up" ? "#16a34a" : "#d97706";
  return (
    <View style={styles.moveRow}>
      <Text>{tone === "up" ? "+ " : "- "}{m.name}{m.levelFrom !== m.levelTo ? ` (${m.levelFrom} -> ${m.levelTo})` : ""}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold", color }}>{m.dOverall >= 0 ? "+" : ""}{m.dOverall}</Text>
    </View>
  );
}

export function BriefingDocument({ briefing, branding }: { briefing: ExecBriefing; branding?: BriefingBranding }) {
  const b = briefing;
  const accent = branding?.brandColor || ACCENT;
  const brandLabel = branding?.brandName || "Ascent";
  return (
    <Document title={`${brandLabel} executive briefing — ${b.org}`} author={brandLabel} subject="AI-native engineering maturity">
      <Page size="A4" style={baseStyles.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image, not an HTML img (no alt) */}
        {branding?.logoUrl ? <Image src={branding.logoUrl} style={{ height: 28, marginBottom: 8 }} /> : null}
        <Text style={{ ...baseStyles.kicker, color: accent }}>{brandLabel} · Executive briefing</Text>
        <Text style={baseStyles.h1}>{b.org}</Text>
        <Text style={baseStyles.meta}>{b.periodTitle} · generated {b.generatedOn}</Text>

        <View style={baseStyles.rule} />
        <View style={baseStyles.statsRow}>
          <Stat label="Overall" value={`${b.maturity.overall}`} sub={`${b.maturity.levelId} ${b.maturity.levelName}`} color={scoreColor(b.maturity.overall)} />
          <Stat label="Adoption" value={`${b.maturity.adoption}`} color={scoreColor(b.maturity.adoption)} />
          <Stat label="Rigor" value={`${b.maturity.rigor}`} color={scoreColor(b.maturity.rigor)} />
          <Stat
            label="Percentile"
            value={b.benchmark?.percentile != null ? `${b.benchmark.percentile}` : "—"}
            sub={b.benchmark && b.benchmark.corpusRepos > 0 ? `vs ${b.benchmark.corpusRepos} repos` : "no corpus"}
            color={b.benchmark?.percentile != null ? scoreColor(b.benchmark.percentile) : FAINT}
          />
        </View>
        {b.periodDelta != null && (
          <Text style={styles.line}>Change vs {b.periodTitle} start: {b.periodDelta >= 0 ? "+" : ""}{b.periodDelta}</Text>
        )}
        {b.forecastHeadline ? <Text style={styles.traj}>Trajectory: {b.forecastHeadline}</Text> : null}
        {/* The same trend-confidence hedge the exec page + LLM markdown carry — so the board PDF can't
            present a noisy, low-R² projection as a firm headline (briefing.ts forecastConfidenceNote). */}
        {b.forecastHeadline && forecastConfidenceNote(b.forecastConfidence) ? (
          <Text style={baseStyles.meta}>{forecastConfidenceNote(b.forecastConfidence)}</Text>
        ) : null}
        {b.benchmark?.cohort && b.benchmark.cohort.overallPercentile != null ? (
          <Text style={styles.line}>
            Peer cohort ({b.benchmark.cohort.language}): {b.benchmark.cohort.overallPercentile}th percentile vs{" "}
            {b.benchmark.cohort.repos} {b.benchmark.cohort.language} repos
            {b.benchmark.cohort.adoptionPercentile != null ? ` · ${b.benchmark.cohort.adoptionPercentile}th on AI adoption` : ""}
          </Text>
        ) : null}
        <Text style={styles.line}>Coverage: {b.coverage.scanned}/{b.coverage.total} repositories scanned</Text>
        {/* Engine-mix provenance — the durable artifact must carry the same mock-degraded caveat the
            page + "Copy for LLM" markdown show, so a board/auditor PDF can't present synthetic scores
            as authoritative (reuses the shared engineMixLabel/engineMixDegraded source of truth). */}
        {b.engineMix.length > 0 && (
          <Text style={styles.line}>
            Scored by {engineMixLabel(b.engineMix)}
            {engineMixDegraded(b.engineMix) ? (
              <Text style={{ color: "#d97706" }}>
                {" "}· ⚠ some scores this period used the deterministic mock engine, not the live model
              </Text>
            ) : null}
          </Text>
        )}

        <View style={baseStyles.rule} />
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={baseStyles.sectionH}>Strengths</Text>
            {b.strengths.map((d) => <DimLine key={d.dimId} d={d} />)}
          </View>
          <View style={styles.col}>
            <Text style={baseStyles.sectionH}>Weakest dimensions</Text>
            {b.risks.map((d) => <DimLine key={d.dimId} d={d} />)}
          </View>
        </View>

        {b.priorPeriod && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>vs previous period</Text>
            <View style={styles.moveRow}>
              <Text>Overall {b.priorPeriod.overall} {"->"} {b.maturity.overall}</Text>
              <Text style={baseStyles.muted}>
                {sgn(b.priorPeriod.dOverall)} · Adoption {sgn(b.priorPeriod.dAdoption)} · Rigor {sgn(b.priorPeriod.dRigor)}
              </Text>
            </View>
            {b.priorPeriod.dims.filter((d) => d.delta !== 0).map((d) => (
              <View key={d.dimId} style={styles.dimRow}>
                <Text>{d.dimId} · {d.label}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold", color: d.delta > 0 ? "#16a34a" : "#d97706" }}>
                  {d.prior} {"->"} {d.now} ({sgn(d.delta)})
                </Text>
              </View>
            ))}
          </View>
        )}

        {(b.topGainers.length > 0 || b.topRegressions.length > 0) && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Movement this period</Text>
            {b.topGainers.map((m) => <MoveLine key={`g-${m.name}`} tone="up" m={m} />)}
            {b.topRegressions.map((m) => <MoveLine key={`r-${m.name}`} tone="down" m={m} />)}
          </View>
        )}

        {b.goals.length > 0 && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Goals</Text>
            {b.goals.map((g) => (
              <View key={g.label} style={styles.goalRow} wrap={false}>
                <Text style={styles.goalLabel}>{g.label}</Text>
                <Text style={baseStyles.muted}>
                  {g.current}/{g.target} ({g.pct}%, {g.pace}{g.etaDays != null ? `, ETA ~${g.etaDays}d` : ""})
                </Text>
              </View>
            ))}
          </View>
        )}

        <Footer note={`Scored by ${brandLabel} · AI-native engineering maturity`} />
      </Page>
    </Document>
  );
}
