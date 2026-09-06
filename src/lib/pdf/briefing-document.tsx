// Board-ready PDF of the executive briefing — the "download a report for the leadership deck"
// artifact (Direction #5 phase 2). Rendered with @react-pdf/renderer (built-in Helvetica, light
// theme) from the same ExecBriefing the /org/[slug]/executive page and the "Copy for LLM" brief use,
// so the page, the clipboard brief, and the PDF can never disagree. Driven by /api/org/briefing/pdf.
// Shares its light-theme scaffolding (palette, scoreColor, base styles, Stat, Footer) with
// report-document.tsx + security-document.tsx via ./theme.

import { Document, Page, Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import { ColumnHeading, DimLine, MoveLine, SectionHeading } from "./briefing-document-rows";
import { benchmarkCaption, briefingHasScore, briefingLevelCaption, briefingLoopProofLine, briefingNextMove, briefingProofLine, briefingTrajectoryNote, coverageLine, engineMixCaveat, engineMixLabel, mockDisclosure, movementLine, nextMoveLine, noScoreLine, scoreBasisLine, scoreValue, valueRealizedHeading, valueRealizedLine } from "@/lib/org/briefing";
import type { ExecBriefing } from "@/lib/org/briefing";
import { ACCENT, INK, MUTED, FAINT, baseStyles, scoreColor, Stat, Footer } from "./theme";
import { latin1Safe } from "./latin1";

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
  // G5-03: the optional LLM narrative. Set in prose-body type, not the metric styles — it is the one
  // block on the page a human reads as sentences rather than scans as figures.
  narrative: { marginTop: 10, color: INK, lineHeight: 1.5 },
  nextMove: { marginTop: 4, color: INK, lineHeight: 1.45 },
});

export function BriefingDocument({ briefing, branding }: { briefing: ExecBriefing; branding?: BriefingBranding }) {
  const b = briefing;
  const accent = branding?.brandColor || ACCENT;
  // latin1Safe: the white-label brand name + org name are user-supplied free text; a non-Latin-1 glyph
  // must show as a visible "?" rather than being silently dropped by the built-in Helvetica (see ./latin1).
  const brandLabel = latin1Safe(branding?.brandName || "Ascent");
  const org = latin1Safe(b.org);
  const scored = briefingHasScore(b);
  return (
    <Document title={`${brandLabel} executive briefing — ${org}`} author={brandLabel} subject="AI-native engineering maturity">
      <Page size="A4" style={baseStyles.page}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image, not an HTML img (no alt) */}
        {branding?.logoUrl ? <Image src={branding.logoUrl} style={{ height: 28, marginBottom: 8 }} /> : null}
        <Text style={{ ...baseStyles.kicker, color: accent }}>{brandLabel} · Executive briefing</Text>
        <Text style={baseStyles.h1}>{org}</Text>
        <Text style={baseStyles.meta}>{b.periodTitle} · generated {b.generatedOn}</Text>

        {/* G5-03: optional executive narrative. `narrative` is null unless a deliverable path opted in
            via attachBriefingNarrative, and every number in it is gated against the briefing's own
            figures — so it can restate the data below but cannot introduce any. Plain prose, no markdown. */}
        {b.narrative ? <Text style={styles.narrative}>{latin1Safe(b.narrative)}</Text> : null}

        <View style={baseStyles.rule} />
        <View style={baseStyles.statsRow}>
          {/* Direction 1 — at `realScoredCount === 0` the three averages are a division guard, not a
              grade, so the headline Stats show "—" and the level caption is suppressed. The PDF is the
              artifact most likely to leave the building unedited; "OVERALL 0 / L1 Ad hoc" on it is a
              claim about a fleet that was never measured. */}
          <Stat
            label="Overall"
            value={scoreValue(b, b.maturity.overall)}
            sub={briefingLevelCaption(b) ?? undefined}
            color={scored ? scoreColor(b.maturity.overall) : FAINT}
          />
          <Stat label="Adoption" value={scoreValue(b, b.maturity.adoption)} color={scored ? scoreColor(b.maturity.adoption) : FAINT} />
          <Stat label="Rigor" value={scoreValue(b, b.maturity.rigor)} color={scored ? scoreColor(b.maturity.rigor) : FAINT} />
          <Stat
            label="Percentile"
            value={b.benchmark?.percentile != null ? `${b.benchmark.percentile}` : "—"}
            // UAT DANA-L1-011/-012 — never caption a suppressed percentile with the corpus that was
            // too small to produce it ("PERCENTILE — vs 1 repos" in a headline board tile).
            sub={benchmarkCaption(b.benchmark)}
            color={b.benchmark?.percentile != null ? scoreColor(b.benchmark.percentile) : FAINT}
          />
        </View>
        {/* The no-score sentence stands where the "change vs …" line would: a reader who sees "—" in
            three headline tiles is owed the reason on the same page, above the fold. */}
        {!scored ? <Text style={styles.line}>{noScoreLine(b)}</Text> : null}
        {scored && b.periodDelta != null && (
          <Text style={styles.line}>Change vs {b.periodTitle} start: {b.periodDelta >= 0 ? "+" : ""}{b.periodDelta}</Text>
        )}
        {/* MC-B1 — this is THE artifact with the org's name on it, and it was the one printing
            "Trajectory: Climbing at +35/wk" off two scan days with the hedge deleted rather than
            replaced. It now reads the same composed line as the screen, the share page and the
            markdown: a headline only once the fit is presentable, always with its basis; otherwise
            the same refusal sentence Delivery prints. */}
        {b.forecastHeadline ? <Text style={styles.traj}>Trajectory: {latin1Safe(b.forecastHeadline)}</Text> : null}
        {b.forecastHeadline && briefingTrajectoryNote(b) ? (
          <Text style={baseStyles.meta}>{latin1Safe(briefingTrajectoryNote(b)!)}</Text>
        ) : null}
        {!b.forecastHeadline && b.forecastInsufficiency ? (
          <Text style={baseStyles.meta}>Trajectory: {latin1Safe(b.forecastInsufficiency)}</Text>
        ) : null}
        {b.benchmark?.cohort && b.benchmark.cohort.overallPercentile != null ? (
          <Text style={styles.line}>
            Peer cohort ({b.benchmark.cohort.language}): {b.benchmark.cohort.overallPercentile}th percentile vs{" "}
            {b.benchmark.cohort.repos} {b.benchmark.cohort.language} repos
            {b.benchmark.cohort.adoptionPercentile != null ? ` · ${b.benchmark.cohort.adoptionPercentile}th on AI adoption` : ""}
          </Text>
        ) : null}
        <Text style={styles.line}>{coverageLine(b)}</Text>
        {/* Direction 1 — coverage answers "how much did we look at"; this answers "what is the
            average averaged over". They are different denominators and used to be conflated. */}
        {scoreBasisLine(b) ? <Text style={baseStyles.meta}>Score basis: {scoreBasisLine(b)}</Text> : null}
        {/* executive-briefing 07-16 #4: the PDF is the surface "most likely to leave the building
            unedited", yet it silently dropped the value-realized (renewal-justification) and
            fleet-adoption lines the exec page + LLM markdown carry. Keep the three renderers in lockstep. */}
        {/* UAT DANA-L1-010 — the heading follows the SIGN. A fleet regression printed under the word
            "Value" is the tool not knowing which direction is good; the number itself is never hidden
            (G1), and it now carries the basis its neighbouring movement line is counted on. */}
        {valueRealizedLine(b.valueRealized, b.realScoredCount) ? (
          <Text style={styles.line}>
            {valueRealizedHeading(b.valueRealized)}: {valueRealizedLine(b.valueRealized, b.realScoredCount)}
          </Text>
        ) : null}
        {b.adoptionRate != null ? (
          <Text style={styles.line}>Fleet adoption: {b.adoptionRate}% of scanned repos at a high AI-adoption posture</Text>
        ) : null}
        {/* The rollout PROOF — same briefingProofLine the exec tab, share page and markdown print,
            so the durable board artifact carries the "it worked" numbers too. Fleet-wide by
            construction (practices aren't segment-scoped). */}
        {briefingProofLine(b.proof ?? null) ? (
          <Text style={styles.line}>Proof — improvement shipped: {briefingProofLine(b.proof ?? null)} (fleet-wide)</Text>
        ) : null}
        {/* MOONSHOT #26 — the LOCAL LOOP's proof, from the same one function every other surface
            prints. Its own line rather than an extension of the one above, because it carries the
            "on branches, not merged" clause: a board reading a points figure without that clause
            would reasonably believe the change had landed. Omitted entirely when null. */}
        {briefingLoopProofLine(b.loopProof ?? null) ? (
          <Text style={styles.line}>Proof — local loop: {briefingLoopProofLine(b.loopProof ?? null)}</Text>
        ) : null}
        {/* Engine-mix provenance — the durable artifact must carry the same mock-degraded caveat the
            page + "Copy for LLM" markdown show, so a board/auditor PDF can't present synthetic scores
            as authoritative (reuses the shared engineMixLabel/engineMixDegraded source of truth). */}
        {b.engineMix.length > 0 && (
          <Text style={styles.line}>
            Scored by {engineMixLabel(b.engineMix)}
            {engineMixCaveat(b.engineMix) ? (
              <Text style={{ color: "#d97706" }}>
                {" "}· ⚠ {engineMixCaveat(b.engineMix)}
              </Text>
            ) : null}
          </Text>
        )}
        {/* G9 — the mock disclosure rides in the PDF BODY, beside the engine-mix caveat, never in a
            footer. It is NOT the same claim: the engine mix counts scans that ran inside the window,
            while the averages read each repo's latest scan at-or-before the upper bound, so a fleet
            whose mock scans predate the window gets no engine-mix caveat and still has a shrunken
            denominator. Direction 1. */}
        {mockDisclosure(b) ? (
          <Text style={{ ...styles.line, color: "#d97706" }}>⚠ {mockDisclosure(b)}</Text>
        ) : null}

        {/* G5-05: Strengths/Weakest-dimensions used to render both column headings unconditionally,
            leaving a labeled-but-blank column when one array is empty (unlike goals/movement, which
            already gate on length). */}
        {(b.strengths.length > 0 || b.risks.length > 0) && (
          <>
            <View style={baseStyles.rule} />
            <View style={styles.twoCol}>
              {b.strengths.length > 0 && (
                <View style={styles.col}>
                  <ColumnHeading>Strengths</ColumnHeading>
                  {b.strengths.map((d) => <DimLine key={d.dimId} d={d} />)}
                </View>
              )}
              {b.risks.length > 0 && (
                <View style={styles.col}>
                  <ColumnHeading>Weakest dimensions</ColumnHeading>
                  {b.risks.map((d) => <DimLine key={d.dimId} d={d} />)}
                </View>
              )}
            </View>
          </>
        )}

        {b.priorPeriod && (
          <View>
            <SectionHeading>vs previous period</SectionHeading>
            <View style={styles.moveRow} wrap={false}>
              <Text>Overall {b.priorPeriod.overall} {"->"} {b.maturity.overall}</Text>
              <Text style={baseStyles.muted}>
                {sgn(b.priorPeriod.dOverall)} · Adoption {sgn(b.priorPeriod.dAdoption)} · Rigor {sgn(b.priorPeriod.dRigor)}
              </Text>
            </View>
            {b.priorPeriod.dims.filter((d) => d.delta !== 0).map((d) => (
              <View key={d.dimId} style={styles.dimRow} wrap={false}>
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
            <SectionHeading>Movement this period</SectionHeading>
            {/* The FULL fleet movement scale (not just the capped top-3 rows below) — same line the
                markdown carries, so a 200-repo fleet's PDF shows the spread. ASCII up/down: the
                built-in Helvetica has no ▲/▼ glyphs (see ./latin1). */}
            {b.movement.compared > 0 ? (
              <Text style={{ ...baseStyles.muted, marginBottom: 4 }}>
                {movementLine(b.movement, b.realScoredCount)}
              </Text>
            ) : null}
            {b.topGainers.map((m) => <MoveLine key={`g-${m.name}`} tone="up" m={m} />)}
            {b.topRegressions.map((m) => <MoveLine key={`r-${m.name}`} tone="down" m={m} />)}
          </View>
        )}

        {b.goals.length > 0 && (
          <View>
            <SectionHeading>Goals</SectionHeading>
            {b.goals.map((g) => (
              <View key={g.label} style={styles.goalRow} wrap={false}>
                <Text style={styles.goalLabel}>{latin1Safe(g.label)}</Text>
                <Text style={baseStyles.muted}>
                  {g.current}/{g.target} ({g.pct}%, {g.pace}{g.etaDays != null ? `, ETA ~${g.etaDays}d` : ""})
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* G5-02: the recommended next move comes from the SAME ranked getOrgRecommendations rows the
            on-screen briefing and the markdown export use — via briefingNextMove/nextMoveLine, so the
            three surfaces cannot name different dimensions. Omitted entirely when the list is empty:
            the old `risks[0] ?? security` fallback is what let a board PDF name a STRENGTH as the
            weakness, and substituting a second notion of "weakest" is the bug, not the fix. */}
        {(() => {
          const rec = briefingNextMove(b);
          if (!rec) return null;
          return (
            <View>
              <SectionHeading>Recommended next move</SectionHeading>
              <Text style={styles.nextMove}>{latin1Safe(nextMoveLine(rec, b.coverage.scanned))}</Text>
            </View>
          );
        })()}

        <Footer note={`Scored by ${brandLabel} · AI-native engineering maturity`} />
      </Page>
    </Document>
  );
}
