// Server-rendered PDF of a maturity report — the "PDF export" sold on the Private tier. Rendered with
// @react-pdf/renderer (built-in Helvetica, no font registration) from a persisted ScanReport. A light
// theme (dark ink on white) reads and prints better than the app's dark canvas. Content flows across
// pages automatically. Driven by src/app/api/report/pdf/route.ts.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { LlmRoadmapItem, ScanReport } from "@/lib/types";
import { isIncompleteReport } from "@/lib/scoring/gate";
import { IMPACT_RANK } from "@/lib/scoring/impact";
import { ACCENT, FAINT, LINE, MUTED, baseStyles, scoreColor, Footer } from "./theme";
import { latin1Safe } from "./latin1";

// report-document keeps its own h1 (fontSize 22) and rule (marginVertical 16) — these legitimately
// differ from the 24/14 used by briefing/security, so they are NOT hoisted into the shared theme.
const styles = StyleSheet.create({
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 6 },
  rule: { borderBottomWidth: 1, borderBottomColor: LINE, marginVertical: 16 },
  scoreRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  scoreNum: { fontSize: 46, fontFamily: "Helvetica-Bold" },
  scoreDen: { fontSize: 14, color: FAINT, marginBottom: 8 },
  levelPill: { marginBottom: 10, fontSize: 11, fontFamily: "Helvetica-Bold", color: ACCENT },
  headline: { marginTop: 8, fontSize: 12, fontFamily: "Helvetica-Bold" },
  levelDesc: { marginTop: 3, color: MUTED },
  axesRow: { flexDirection: "row", gap: 24, marginTop: 14 },
  axis: { flexDirection: "column" },
  axisLabel: { fontSize: 8, letterSpacing: 2, color: FAINT, textTransform: "uppercase" },
  axisVal: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 2 },
  twoCol: { flexDirection: "row", gap: 24, marginTop: 4 },
  col: { flexDirection: "column", width: "50%" },
  bullet: { flexDirection: "row", gap: 5, marginBottom: 3 },
  bulletMark: { color: ACCENT },
  bulletBad: { color: "#dc2626" },
  dimRow: { marginBottom: 9 },
  dimHead: { flexDirection: "row", justifyContent: "space-between" },
  dimName: { fontFamily: "Helvetica-Bold" },
  dimSummary: { color: MUTED, marginTop: 1 },
  // Caveat block (report.warnings / incomplete scans) — an amber-bordered box near the top so a
  // degraded/incomplete export reads as caveated rather than a confident, complete document.
  warnBox: { borderWidth: 1, borderColor: "#f59e0b", backgroundColor: "#fffbeb", borderRadius: 4, padding: 8, marginTop: 10, gap: 3 },
  warnBadge: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#b45309", textTransform: "uppercase", letterSpacing: 1 },
  warnText: { fontSize: 9, color: "#92400e" },
  // Roadmap / recommendations (G5-09) — each row is capped and wrap={false} together, so a long LLM
  // rationale can't blow past a page's remaining height the way an unbounded wrap={false} block would.
  roadmapRow: { marginBottom: 10 },
  roadmapHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  roadmapTitle: { fontFamily: "Helvetica-Bold", flexShrink: 1 },
  roadmapMeta: { color: FAINT, fontSize: 9 },
  roadmapRationale: { color: MUTED, marginTop: 1 },
});

// A verbose LLM-generated string dropped into a `wrap={false}` block can exceed a page's remaining
// height (G5-08/G5-09) — @react-pdf's handling of an unsplittable block taller than the page is
// inconsistent (clip / overlap / blank page). Cap length defensively rather than trust the model.
function truncateText(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

const MAX_DIM_SUMMARY_CHARS = 320;
const MAX_ROADMAP_RATIONALE_CHARS = 280;

/** Quick-wins-first ordering for the PDF roadmap — same impact-dominates/effort-tiebreak contract as
 *  the in-app roadmap (roadmapPriority.tsx), reimplemented locally: that module lives under
 *  src/components/report/, out of scope for this file's edit. */
function roadmapPriority(item: Pick<LlmRoadmapItem, "impact" | "effort">): number {
  const effortRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  return (IMPACT_RANK[item.impact] ?? 0) * 10 - (effortRank[item.effort] ?? 0);
}

export function ReportDocument({ report }: { report: ScanReport }) {
  const { repo, level } = report;
  const ref = `${repo.owner}/${repo.name}`;
  // G5-22: a long unbroken "owner/name" has no whitespace for @react-pdf's line-wrapper to break on
  // and a fixed fontSize:22 h1, so it can run past the page margin and clip on the flagship page of
  // the paid PDF. Insert a zero-width space after "/" as a soft-break point, and scale the font down
  // for long refs instead of always rendering the same fixed size.
  const ZERO_WIDTH_SPACE = "​";
  const refDisplay = `${latin1Safe(repo.owner)}/${ZERO_WIDTH_SPACE}${latin1Safe(repo.name)}`;
  const h1FontSize = ref.length > 42 ? 14 : ref.length > 28 ? 18 : 22;
  // Parse defensively: a truthy-but-unparseable persisted `scannedAt` (legacy/garbage/reconstructed
  // snapshot) would make `new Date(...).toISOString()` throw `RangeError: Invalid time value`, which
  // propagates out of the document and fails the whole PDF render over one cosmetic date field.
  const scannedAtDate = report.scannedAt ? new Date(report.scannedAt) : null;
  const scannedAt =
    scannedAtDate && !Number.isNaN(scannedAtDate.getTime())
      ? scannedAtDate.toISOString().slice(0, 10)
      : "";

  // G5-07: a sparse/degraded scan (isIncompleteReport — every detector failed, `dimensions` is empty)
  // must never read as a confident, complete document. `report.warnings` already carries the engine's
  // own "INCOMPLETE scan" prose when this fires; the standalone banner below is the fallback for a
  // persisted/reconstructed report that predates `warnings`/`incomplete` but still has zero dimensions.
  const incomplete = isIncompleteReport(report);
  const warnings = report.warnings ?? [];
  const hasIncompleteWarning = warnings.some((w) => /incomplete/i.test(w));
  const orderedRoadmap = [...report.roadmap].sort((a, b) => roadmapPriority(b) - roadmapPriority(a));

  return (
    <Document title={`Ascent maturity report — ${ref}`} author="Ascent" subject="AI-native engineering maturity">
      <Page size="A4" style={baseStyles.page}>
        <Text style={baseStyles.kicker}>Ascent · AI-native maturity report</Text>
        {/* User/LLM-derived text is wrapped in latin1Safe so any non-Latin-1 glyph shows as a visible
            "?" instead of being silently dropped by the built-in Helvetica font (see ./latin1). */}
        <Text style={{ ...styles.h1, fontSize: h1FontSize }}>{refDisplay}</Text>
        <Text style={baseStyles.meta}>{repo.url}{repo.primaryLanguage ? ` · ${latin1Safe(repo.primaryLanguage)}` : ""}{scannedAt ? ` · scanned ${scannedAt}` : ""}</Text>

        {incomplete && !hasIncompleteWarning && (
          <View style={styles.warnBox}>
            <Text style={styles.warnBadge}>⚠ Incomplete scan</Text>
            <Text style={styles.warnText}>
              No dimension could be scored for this repository — every detector failed or returned no
              data. The score below is a renormalized floor, not a genuine measurement; re-scan or
              check repository access.
            </Text>
          </View>
        )}
        {warnings.length > 0 && (
          <View style={styles.warnBox}>
            {warnings.map((w, i) => (
              <Text key={i} style={styles.warnText}>⚠ {latin1Safe(w)}</Text>
            ))}
          </View>
        )}

        <View style={styles.rule} />

        <View style={styles.scoreRow}>
          <Text style={{ ...styles.scoreNum, color: scoreColor(report.overallScore) }}>{report.overallScore}</Text>
          <Text style={styles.scoreDen}>/100</Text>
          <Text style={styles.levelPill}>{level.id} · {latin1Safe(level.name)}</Text>
        </View>
        <Text style={styles.headline}>{latin1Safe(report.headline)}</Text>
        <Text style={styles.levelDesc}>{latin1Safe(level.description)}</Text>

        <View style={styles.axesRow}>
          <View style={styles.axis}>
            <Text style={styles.axisLabel}>Adoption</Text>
            <Text style={{ ...styles.axisVal, color: scoreColor(report.adoptionScore) }}>{report.adoptionScore}</Text>
          </View>
          <View style={styles.axis}>
            <Text style={styles.axisLabel}>Rigor</Text>
            <Text style={{ ...styles.axisVal, color: scoreColor(report.rigorScore) }}>{report.rigorScore}</Text>
          </View>
          <View style={styles.axis}>
            <Text style={styles.axisLabel}>Posture</Text>
            <Text style={{ ...styles.axisVal, fontSize: 12, marginTop: 4 }}>{latin1Safe(report.posture.label)}</Text>
          </View>
        </View>

        {(report.strengths.length > 0 || report.risks.length > 0) && (
          <>
            <View style={styles.rule} />
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={baseStyles.sectionH}>Strengths</Text>
                {report.strengths.length === 0 && <Text style={{ color: FAINT }}>None surfaced.</Text>}
                {report.strengths.map((s, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={styles.bulletMark}>+</Text>
                    <Text>{latin1Safe(s)}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.col}>
                <Text style={baseStyles.sectionH}>Risks & gaps</Text>
                {report.risks.length === 0 && <Text style={{ color: FAINT }}>None surfaced.</Text>}
                {report.risks.map((r, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={styles.bulletBad}>!</Text>
                    <Text>{latin1Safe(r)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {/* G5-07: an empty `dimensions` array (sparse/incomplete scan) used to render this heading
            unconditionally, leaving a labeled-but-blank section in a paid export. The rule+heading are
            kept together with minPresenceAhead (G5-06's fix, applied here too since it's new/adjacent
            layout) so the heading can't be stranded alone at the bottom of a page. */}
        {report.dimensions.length > 0 ? (
          <>
            <View wrap={false} minPresenceAhead={28}>
              <View style={styles.rule} />
              <Text style={baseStyles.sectionH}>Scoring by dimension</Text>
            </View>
            {report.dimensions.map((d) => (
              <View key={d.id} style={styles.dimRow} wrap={false}>
                <View style={styles.dimHead}>
                  <Text style={styles.dimName}>{d.id} · {latin1Safe(d.name)}</Text>
                  <Text style={{ fontFamily: "Helvetica-Bold", color: scoreColor(d.score) }}>{d.score}/100</Text>
                </View>
                {/* G5-08: an unbounded LLM `summary` inside a wrap={false} block can exceed the page's
                    remaining height — @react-pdf's handling of an unsplittable block taller than the
                    page is inconsistent (clip / overlap / blank page). Cap it defensively. */}
                {d.summary ? (
                  <Text style={styles.dimSummary}>{latin1Safe(truncateText(d.summary, MAX_DIM_SUMMARY_CHARS))}</Text>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <>
            <View style={styles.rule} />
            <Text style={{ color: FAINT }}>No per-dimension scoring available.</Text>
          </>
        )}

        {/* G5-09: the roadmap/recommendations — the actionable, paid-for part the export previously
            omitted entirely. Same quick-wins-first ordering as the in-app roadmap. Each row is
            wrap={false} (so a heading never orphans from its own row) but bounded in size (title +
            a capped rationale), so a long/verbose roadmap can paginate freely across rows without any
            single row risking an unsplittable block taller than a page (the G5-06/G5-08 failure mode). */}
        {orderedRoadmap.length > 0 && (
          <View>
            <View wrap={false} minPresenceAhead={28}>
              <View style={styles.rule} />
              <Text style={baseStyles.sectionH}>Roadmap & recommendations</Text>
            </View>
            {orderedRoadmap.map((item, i) => (
              <View key={`${item.dimension}-${i}`} style={styles.roadmapRow} wrap={false}>
                <View style={styles.roadmapHead}>
                  <Text style={styles.roadmapTitle}>{i + 1}. {latin1Safe(item.title)}</Text>
                  <Text style={styles.roadmapMeta}>
                    {item.impact} impact · {item.effort} effort{item.levelUnlock ? ` · ${latin1Safe(item.levelUnlock)}` : ""}
                  </Text>
                </View>
                {item.rationale ? (
                  <Text style={styles.roadmapRationale}>
                    {latin1Safe(truncateText(item.rationale, MAX_ROADMAP_RATIONALE_CHARS))}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        <Footer note={`Scored by Ascent · engine: ${report.engine.provider} · coverage ${Math.round(report.confidence * 100)}%`} />
      </Page>
    </Document>
  );
}
