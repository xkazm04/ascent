// Board-ready PDF of the security posture (SEC-6) — the "hand the auditor / leadership a report"
// artifact for the Security tab. Rendered with @react-pdf/renderer from the same SecurityOverview the
// /org/[slug]/security page and its "Copy for LLM" brief use, so page, clipboard, and PDF stay in
// lockstep. Driven by /api/org/security/pdf. Shares its light theme (palette, scoreColor, base styles,
// Stat, Footer) with briefing-document.tsx + report-document.tsx via ./theme.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { SecurityOverview } from "@/lib/org/security";
import type { OrgSupplyChain } from "@/lib/security/supply-chain";
import { FAINT, baseStyles, scoreColor, Stat, Footer } from "./theme";
import { latin1Safe } from "./latin1";

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  // Risk-register table columns — fixed score column, flexed repo/gate/rules.
  regRow: { flexDirection: "row", gap: 8, marginBottom: 3 },
  regHead: { fontSize: 8, letterSpacing: 1.5, color: FAINT, textTransform: "uppercase" },
  regRepo: { flexBasis: 130, flexShrink: 0 },
  regScore: { flexBasis: 28, flexShrink: 0, textAlign: "right" },
  regGate: { flexGrow: 1 },
  regRules: { flexBasis: 140, flexShrink: 0 },
});

// How many advisory-bearing repos the supply-chain section lists by name (mirrors securityMarkdown's cap).
const SUPPLY_REPO_CAP = 6;

export function SecurityDocument({ overview, supply }: { overview: SecurityOverview; supply?: OrgSupplyChain | null }) {
  const o = overview;
  const atRisk = o.band.critical + o.band.weak;
  const gate = o.securityGate;
  // Honest title: only claim "Supply-chain" when the document actually carries supply-chain data
  // (including the degraded/UNKNOWN state). With scanning off, this is a security-posture report.
  const subject = supply ? "Supply-chain & security posture" : "Security posture";
  const supplyRepos = supply && supply.scanned > 0 ? supply.repos.filter((r) => r.total > 0) : [];
  return (
    <Document title={`Ascent security posture — ${o.org}`} author="Ascent" subject={subject}>
      <Page size="A4" style={baseStyles.page}>
        <Text style={baseStyles.kicker}>Ascent · Security posture</Text>
        {/* latin1Safe: org + repo names are user data — a non-Latin-1 glyph must show as a visible "?"
            rather than be silently dropped by the built-in Helvetica font (see ./latin1). */}
        <Text style={baseStyles.h1}>{latin1Safe(o.org)}</Text>
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

        {o.register.length > 0 && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Risk register (worst first)</Text>
            <View style={styles.regRow} wrap={false}>
              <Text style={{ ...styles.regRepo, ...styles.regHead }}>Repo</Text>
              <Text style={{ ...styles.regScore, ...styles.regHead }}>D9</Text>
              <Text style={{ ...styles.regGate, ...styles.regHead }}>Gate</Text>
              <Text style={{ ...styles.regRules, ...styles.regHead }}>Branch rules</Text>
            </View>
            {o.register.slice(0, 20).map((r) => (
              <View key={r.fullName} style={styles.regRow} wrap={false}>
                <Text style={styles.regRepo}>{latin1Safe(r.name)}</Text>
                <Text style={{ ...styles.regScore, fontFamily: "Helvetica-Bold", color: scoreColor(r.score) }}>{r.score}</Text>
                <Text style={{ ...styles.regGate, color: r.gateReason ? "#dc2626" : "#16a34a" }}>
                  {r.gateReason ? `FAIL — ${latin1Safe(r.gateReason)}` : "pass"}
                </Text>
                <Text style={{ ...styles.regRules, ...baseStyles.muted }}>
                  {r.rules
                    ? [r.rules.protected && "protected", r.rules.review && "review", r.rules.checks && "checks", r.rules.signed && "signed"]
                        .filter(Boolean)
                        .join(", ") || "none"
                    : "unreadable"}
                </Text>
              </View>
            ))}
            {o.register.length > 20 ? <Text style={baseStyles.muted}>…and {o.register.length - 20} more repos.</Text> : null}
          </View>
        )}

        {o.unprotected.length > 0 && (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>No default-branch protection ({o.unprotected.length})</Text>
            <Text style={baseStyles.muted}>{o.unprotected.slice(0, 20).map((r) => latin1Safe(r.name)).join(" · ")}</Text>
          </View>
        )}

        {/* Supply chain — mirrors securityMarkdown so the auditor artifact never claims more (or less)
            than the page/brief. The degraded state MUST be stated: a formal PDF that silently reads
            clean during an advisory outage is the exact false signal this view exists to prevent. */}
        {supply?.degraded ? (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Supply chain — UNKNOWN</Text>
            <Text style={{ color: "#d97706" }}>
              Vulnerability advisory data could NOT be fetched for this organization (GitHub advisory access
              failed). The absence of advisories in this document is not evidence of a clean supply chain —
              do not treat this section as a pass.
            </Text>
          </View>
        ) : supply && supply.scanned > 0 ? (
          <View>
            <View style={baseStyles.rule} />
            <Text style={baseStyles.sectionH}>Supply chain (Dependabot{supply.demo ? " — demo data" : ""})</Text>
            <Text style={baseStyles.muted}>
              Open advisories across {supply.scanned} scanned repos — {supply.totals.critical} critical ·{" "}
              {supply.totals.high} high · {supply.totals.medium} medium · {supply.totals.low} low
            </Text>
            {supplyRepos.slice(0, SUPPLY_REPO_CAP).map((r) => (
              <Text key={r.fullName} style={{ marginTop: 2 }}>
                {latin1Safe(r.name)}: {r.critical} critical, {r.high} high ({r.total} total)
              </Text>
            ))}
            {supplyRepos.length > SUPPLY_REPO_CAP ? (
              <Text style={{ marginTop: 2, ...baseStyles.muted }}>
                …and {supplyRepos.length - SUPPLY_REPO_CAP} more repos with open advisories (see the dashboard).
              </Text>
            ) : null}
          </View>
        ) : null}

        <Footer note={`Scored by Ascent · ${subject}`} />
      </Page>
    </Document>
  );
}
