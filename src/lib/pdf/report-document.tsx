// Server-rendered PDF of a maturity report — the "PDF export" sold on the Private tier. Rendered with
// @react-pdf/renderer (built-in Helvetica, no font registration) from a persisted ScanReport. A light
// theme (dark ink on white) reads and prints better than the app's dark canvas. Content flows across
// pages automatically. Driven by src/app/api/report/pdf/route.ts.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ScanReport } from "@/lib/types";
import { ACCENT, FAINT, LINE, MUTED, baseStyles, scoreColor, Footer } from "./theme";

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
});

export function ReportDocument({ report }: { report: ScanReport }) {
  const { repo, level } = report;
  const ref = `${repo.owner}/${repo.name}`;
  // Parse defensively: a truthy-but-unparseable persisted `scannedAt` (legacy/garbage/reconstructed
  // snapshot) would make `new Date(...).toISOString()` throw `RangeError: Invalid time value`, which
  // propagates out of the document and fails the whole PDF render over one cosmetic date field.
  const scannedAtDate = report.scannedAt ? new Date(report.scannedAt) : null;
  const scannedAt =
    scannedAtDate && !Number.isNaN(scannedAtDate.getTime())
      ? scannedAtDate.toISOString().slice(0, 10)
      : "";

  return (
    <Document title={`Ascent maturity report — ${ref}`} author="Ascent" subject="AI-native engineering maturity">
      <Page size="A4" style={baseStyles.page}>
        <Text style={baseStyles.kicker}>Ascent · AI-native maturity report</Text>
        <Text style={styles.h1}>{ref}</Text>
        <Text style={baseStyles.meta}>{repo.url}{repo.primaryLanguage ? ` · ${repo.primaryLanguage}` : ""}{scannedAt ? ` · scanned ${scannedAt}` : ""}</Text>

        <View style={styles.rule} />

        <View style={styles.scoreRow}>
          <Text style={{ ...styles.scoreNum, color: scoreColor(report.overallScore) }}>{report.overallScore}</Text>
          <Text style={styles.scoreDen}>/100</Text>
          <Text style={styles.levelPill}>{level.id} · {level.name}</Text>
        </View>
        <Text style={styles.headline}>{report.headline}</Text>
        <Text style={styles.levelDesc}>{level.description}</Text>

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
            <Text style={{ ...styles.axisVal, fontSize: 12, marginTop: 4 }}>{report.posture.label}</Text>
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
                    <Text>{s}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.col}>
                <Text style={baseStyles.sectionH}>Risks & gaps</Text>
                {report.risks.length === 0 && <Text style={{ color: FAINT }}>None surfaced.</Text>}
                {report.risks.map((r, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={styles.bulletBad}>!</Text>
                    <Text>{r}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        <View style={styles.rule} />
        <Text style={baseStyles.sectionH}>Scoring by dimension</Text>
        {report.dimensions.map((d) => (
          <View key={d.id} style={styles.dimRow} wrap={false}>
            <View style={styles.dimHead}>
              <Text style={styles.dimName}>{d.id} · {d.name}</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", color: scoreColor(d.score) }}>{d.score}/100</Text>
            </View>
            {d.summary ? <Text style={styles.dimSummary}>{d.summary}</Text> : null}
          </View>
        ))}

        <Footer note={`Scored by Ascent · engine: ${report.engine.provider} · coverage ${Math.round(report.confidence * 100)}%`} />
      </Page>
    </Document>
  );
}
