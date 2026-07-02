// Board-ready PDF of the security posture (SEC-6) — the "hand the auditor / leadership a report"
// artifact for the Security tab. Rendered with @react-pdf/renderer from the same SecurityOverview the
// /org/[slug]/security page and its "Copy for LLM" brief use, so page, clipboard, and PDF stay in
// lockstep. Driven by /api/org/security/pdf. Mirrors briefing-document.tsx's light theme.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { SecurityOverview } from "@/lib/org/security";

const ACCENT = "#2563eb";
const INK = "#0f172a";
const MUTED = "#475569";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";

function scoreColor(s: number): string {
  if (s >= 80) return "#16a34a";
  if (s >= 60) return ACCENT;
  if (s >= 40) return "#d97706";
  return "#dc2626";
}

const styles = StyleSheet.create({
  page: { paddingVertical: 44, paddingHorizontal: 48, fontSize: 10, color: INK, fontFamily: "Helvetica", lineHeight: 1.45 },
  kicker: { fontSize: 9, letterSpacing: 3, color: ACCENT, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  h1: { fontSize: 24, fontFamily: "Helvetica-Bold", marginTop: 6 },
  meta: { fontSize: 9, color: FAINT, marginTop: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: LINE, marginVertical: 14 },
  statsRow: { flexDirection: "row", gap: 28 },
  stat: { flexDirection: "column" },
  statLabel: { fontSize: 8, letterSpacing: 2, color: FAINT, textTransform: "uppercase" },
  statVal: { fontSize: 26, fontFamily: "Helvetica-Bold", marginTop: 2 },
  statSub: { fontSize: 8, color: MUTED, marginTop: 1 },
  sectionH: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  muted: { color: MUTED },
  // Risk-register table columns — fixed score column, flexed repo/gate/rules.
  regRow: { flexDirection: "row", gap: 8, marginBottom: 3 },
  regHead: { fontSize: 8, letterSpacing: 1.5, color: FAINT, textTransform: "uppercase" },
  regRepo: { flexBasis: 130, flexShrink: 0 },
  regScore: { flexBasis: 28, flexShrink: 0, textAlign: "right" },
  regGate: { flexGrow: 1 },
  regRules: { flexBasis: 140, flexShrink: 0 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: FAINT, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
});

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={{ ...styles.statVal, color }}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export function SecurityDocument({ overview }: { overview: SecurityOverview }) {
  const o = overview;
  const atRisk = o.band.critical + o.band.weak;
  const gate = o.securityGate;
  return (
    <Document title={`Ascent security posture — ${o.org}`} author="Ascent" subject="Supply-chain & security posture">
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>Ascent · Security posture</Text>
        <Text style={styles.h1}>{o.org}</Text>
        <Text style={styles.meta}>{o.periodTitle} · generated {o.generatedOn} · {o.dimLabel} (D9)</Text>

        <View style={styles.rule} />
        <View style={styles.statsRow}>
          <Stat label="Avg Security (D9)" value={o.avgSecurity != null ? `${o.avgSecurity}` : "—"} color={o.avgSecurity != null ? scoreColor(o.avgSecurity) : FAINT} />
          <Stat label="Branch protection" value={o.governance ? `${o.governance.protectedRate}%` : "—"} sub={o.governance ? `${o.governance.repos} repos with rules` : "no data"} color={o.governance ? scoreColor(o.governance.protectedRate) : FAINT} />
          <Stat label="Gate passing" value={`${gate.passing}/${gate.passing + gate.failing}`} sub={`min D9 ${gate.minSecurity}`} color={gate.failing === 0 ? "#16a34a" : "#d97706"} />
          <Stat label="At-risk repos" value={`${atRisk}`} sub={`${o.band.critical} critical · ${o.band.weak} weak`} color={atRisk > 0 ? "#dc2626" : "#16a34a"} />
        </View>
        <Text style={{ marginTop: 10, ...styles.muted }}>
          Bands — critical {o.band.critical} · weak {o.band.weak} · ok {o.band.ok} · strong {o.band.strong} (of {o.scanned} scanned)
        </Text>
        {o.governance ? (
          <Text style={{ marginTop: 4, ...styles.muted }}>
            Governance — require review {o.governance.requireReviewRate}% · require checks {o.governance.requireChecksRate}% · signed {o.governance.signedRate}%
          </Text>
        ) : null}

        {o.register.length > 0 && (
          <View>
            <View style={styles.rule} />
            <Text style={styles.sectionH}>Risk register (worst first)</Text>
            <View style={styles.regRow} wrap={false}>
              <Text style={{ ...styles.regRepo, ...styles.regHead }}>Repo</Text>
              <Text style={{ ...styles.regScore, ...styles.regHead }}>D9</Text>
              <Text style={{ ...styles.regGate, ...styles.regHead }}>Gate</Text>
              <Text style={{ ...styles.regRules, ...styles.regHead }}>Branch rules</Text>
            </View>
            {o.register.slice(0, 20).map((r) => (
              <View key={r.fullName} style={styles.regRow} wrap={false}>
                <Text style={styles.regRepo}>{r.name}</Text>
                <Text style={{ ...styles.regScore, fontFamily: "Helvetica-Bold", color: scoreColor(r.score) }}>{r.score}</Text>
                <Text style={{ ...styles.regGate, color: r.gateReason ? "#dc2626" : "#16a34a" }}>
                  {r.gateReason ? `FAIL — ${r.gateReason}` : "pass"}
                </Text>
                <Text style={{ ...styles.regRules, ...styles.muted }}>
                  {r.rules
                    ? [r.rules.protected && "protected", r.rules.review && "review", r.rules.checks && "checks", r.rules.signed && "signed"]
                        .filter(Boolean)
                        .join(", ") || "none"
                    : "unreadable"}
                </Text>
              </View>
            ))}
            {o.register.length > 20 ? <Text style={styles.muted}>…and {o.register.length - 20} more repos.</Text> : null}
          </View>
        )}

        {o.unprotected.length > 0 && (
          <View>
            <View style={styles.rule} />
            <Text style={styles.sectionH}>No default-branch protection ({o.unprotected.length})</Text>
            <Text style={styles.muted}>{o.unprotected.slice(0, 20).map((r) => r.name).join(" · ")}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Scored by Ascent · Supply-chain & security posture</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
