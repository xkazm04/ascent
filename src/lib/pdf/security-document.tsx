// Board-ready PDF of the security posture (SEC-6) — the "hand the auditor / leadership a report"
// artifact for the Security tab. Rendered with @react-pdf/renderer from the same SecurityOverview the
// /org/[slug]/security page and its "Copy for LLM" brief use, so page, clipboard, and PDF stay in
// lockstep. Driven by /api/org/security/pdf. Shares its light theme (palette, scoreColor, base styles,
// Stat, Footer) with briefing-document.tsx + report-document.tsx via ./theme.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { SecurityOverview } from "@/lib/org/security";
import { FAINT, baseStyles, scoreColor, Stat, Footer } from "./theme";

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
});

export function SecurityDocument({ overview }: { overview: SecurityOverview }) {
  const o = overview;
  const atRisk = o.band.critical + o.band.weak;
  const gate = o.securityGate;
  return (
    <Document title={`Ascent security posture — ${o.org}`} author="Ascent" subject="Supply-chain & security posture">
      <Page size="A4" style={baseStyles.page}>
        <Text style={baseStyles.kicker}>Ascent · Security posture</Text>
        <Text style={baseStyles.h1}>{o.org}</Text>
        <Text style={baseStyles.meta}>{o.periodTitle} · generated {o.generatedOn} · {o.dimLabel} (D9)</Text>

        <View style={baseStyles.rule} />
        <View style={baseStyles.statsRow}>
          <Stat label="Avg Security (D9)" value={o.avgSecurity != null ? `${o.avgSecurity}` : "—"} color={o.avgSecurity != null ? scoreColor(o.avgSecurity) : FAINT} />
          <Stat label="Branch protection" value={o.governance ? `${o.governance.protectedRate}%` : "—"} sub={o.governance ? `${o.governance.repos} repos with rules` : "no data"} color={o.governance ? scoreColor(o.governance.protectedRate) : FAINT} />
          <Stat label="Gate passing" value={`${gate.passing}/${gate.passing + gate.failing}`} sub={`min D9 ${gate.minSecurity}`} color={gate.failing === 0 ? "#16a34a" : "#d97706"} />
          <Stat label="At-risk repos" value={`${atRisk}`} sub={`${o.band.critical} critical · ${o.band.weak} weak`} color={atRisk > 0 ? "#dc2626" : "#16a34a"} />
        </View>
        <Text style={{ marginTop: 10, ...baseStyles.muted }}>
          Bands — critical {o.band.critical} · weak {o.band.weak} · ok {o.band.ok} · strong {o.band.strong} (of {o.scanned} scanned)
        </Text>
        {o.governance ? (
          <Text style={{ marginTop: 4, ...baseStyles.muted }}>
            Governance — require review {o.governance.requireReviewRate}% · require checks {o.governance.requireChecksRate}% · signed {o.governance.signedRate}%
          </Text>
        ) : null}

        {o.weakest.length > 0 && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Weakest repositories (Security D9)</Text>
            {o.weakest.slice(0, 12).map((r) => (
              <View key={r.fullName} style={styles.row} wrap={false}>
                <Text>{r.fullName}</Text>
                <Text style={{ fontFamily: "Helvetica-Bold", color: scoreColor(r.score) }}>{r.score}/100</Text>
              </View>
            ))}
          </View>
        )}

        {gate.failingRepos.length > 0 && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Failing the security gate</Text>
            {gate.failingRepos.slice(0, 12).map((r) => (
              <View key={r.fullName} style={styles.row} wrap={false}>
                <Text>{r.fullName}</Text>
                <Text style={baseStyles.muted}>{r.reason}</Text>
              </View>
            ))}
          </View>
        )}

        {o.unprotected.length > 0 && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>No default-branch protection ({o.unprotected.length})</Text>
            <Text style={baseStyles.muted}>{o.unprotected.slice(0, 20).map((r) => r.name).join(" · ")}</Text>
          </View>
        )}

        <Footer note="Scored by Ascent · Supply-chain & security posture" />
      </Page>
    </Document>
  );
}
