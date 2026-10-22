// The Altimeter composition of the Security tab: the former SecurityTab markup, moved here unchanged.
// It takes the SecurityTabData the entry computed (SecurityTab.tsx), so the v2 composition reads the same values.
import { CHECK_AXES } from "./securityMatrixModel";
import { Card, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { DownloadButton } from "@/components/report/DownloadButton";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { SecurityFindings } from "@/components/org/SecurityFindings";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { scoreHex } from "@/lib/ui";
import { chipButtonClass } from "@/components/ui";
import { SecurityBandSpectrum } from "./SecurityBandSpectrum";
import { SecurityRiskRegister } from "./SecurityRiskRegister";
import type { SecurityTabData } from "./securityTabData";

export function securityV1(d: SecurityTabData) {
  const { slug, sec, decisions, md, gateSnippet, advisories, advisoriesDemo, supplyDegraded, comparisonLabel, stack } = d;
  const atRisk = sec.band.critical + sec.band.weak;
  const gov = sec.governance;
  const gate = sec.securityGate;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Title only. The three-sentence standfirst that used to sit here (what the score is
            evidenced from, how it is computed, that a score is clickable) restated what the Control
            matrix caption below already says, one screenful above the thing it describes — so it
            pushed the tiles down on every visit and was read on none. */}
        <SectionHeader title="Security" />
        <div className="flex flex-wrap items-center gap-2">
          <TechStackSelector groups={stack.groups} active={stack.active} />
          {/* Fetch-and-download (not a bare anchor): the PDF render is slow and error branches return
              JSON — a plain <a> navigated the user onto a raw JSON page on failure (pdf-llm-export #1). */}
          <DownloadButton
            href={d.pdfHref}
            className={chipButtonClass()}
            title="Download the security posture as a PDF"
          >
            <span aria-hidden>↓</span> Download PDF
          </DownloadButton>
          <CopyForLlm text={md} label="Copy security brief for LLM" />
        </div>
      </div>

      <div className={TILE_GRID}>
        <Tile
          label="Avg Security (D9)"
          value={sec.avgSecurity ?? "—"}
          color={sec.avgSecurity != null ? scoreHex(sec.avgSecurity) : undefined}
          delta={sec.securityCohortSize != null ? sec.securityDelta : null}
          deltaLabel={
            sec.securityCohortSize != null
              ? `${comparisonLabel} · ${sec.securityCohortSize} repo${sec.securityCohortSize === 1 ? "" : "s"}`
              : comparisonLabel
          }
        />
        <Tile
          label="Branch protection"
          value={gov ? `${gov.protectedRate}%` : "—"}
          sub={gov ? `${gov.repos} repos with rules` : "no governance data"}
          color={gov ? scoreHex(gov.protectedRate) : undefined}
        />
        <Tile label="Repos at risk" value={atRisk} sub="critical + weak (D9 < 60)" color={atRisk > 0 ? "#d97706" : "#16a34a"} />
        <Tile
          label="Security gate"
          value={gate.failing > 0 ? `${gate.failing} fail` : "all pass"}
          sub={`${gate.passing} of ${sec.scanned} pass`}
          color={gate.failing > 0 ? "#dc2626" : "#16a34a"}
        />
        {/* Last cell of the same ledger, spanning every column: the band spectrum is the frame's
            bottom edge rather than a strip floating under it. Must stay a DIRECT child of TILE_GRID —
            the `gap-px` hairline bed only works on direct children. */}
        <SecurityBandSpectrum band={sec.band} scanned={sec.scanned} />
      </div>

      <Card>
        {/* MC-B10 — "Control matrix" until 2026-08-31. Passports carried a "Controls" tab and
            Governance a "Control observations" card, so the same word named three unrelated
            catalogues on one dashboard. This one is the D9 battery.

            The four-sentence caption that stood here until 2026-09-08 is gone, per §2 of
            docs/ORG-UX-REDESIGN.md. It stated the grading scale and the gate policy (now the ≤60-char
            unit line below), described the ┃ posture/exposure divider and the "failing first" order
            (now drawn — the matrix's own legend and WhyChip carry the split, and the order IS the
            sort), and disambiguated this catalogue from Passports › Doctor checks and Governance ›
            Governance control ledger (that belongs in the feature doc, not permanently above the
            panel it describes). */}
        <SectionHeader
          size="sm"
          title="D9 check battery"
          description={`${sec.scanned} repos × ${CHECK_AXES.length} controls · gate D9 ≥ ${gate.minSecurity}`}
          right={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />}
        />
        {supplyDegraded && (
          // DELIBERATELY NOT DEMOTED. Every other sentence on this tab moved into a state, a legend or
          // the doc; this one stays in body text at full size because a hover tooltip is invisible in a
          // screenshot, in a PDF export and to anyone skimming — and the failure it describes ("we
          // could not look") is the single reading on this page that must never be mistaken for a pass.
          <p role="status" className="mb-3 mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 type-body-sm text-warn">
            Vulnerability advisories couldn&apos;t be fetched for this org, so the <strong>Advisories</strong>{" "}
            column below is not shown at all — a column you have to notice is missing. That is{" "}
            <strong>not</strong> a clean bill of health. Re-check the GitHub App installation and its
            security-advisory access, then reload.
          </p>
        )}
        <SecurityRiskRegister
          org={slug}
          rows={sec.register}
          // Pass the full severity breakdown. Mapping only critical/high hid moderate/low exposure
          // behind a bare total on the register — and must not coerce an omitted band to 0 (G4).
          advisories={advisories}
          // security-posture-audit-log #3: the mock provider's honesty flag was wired into the
          // markdown brief ("Dependabot — demo data") but never the on-screen register, so fabricated
          // counts rendered as fleet fact with live GitHub links. Label + de-link them.
          advisoriesDemo={advisoriesDemo}
        />
        {/* The grid says which controls fail; this is where you decide what to do about each one. */}
        <SecurityFindings org={slug} rows={sec.register} decisions={decisions} />
      </Card>
      <NextMoveLink href={orgTabHref(slug, "proposals")} to="proposals" />
    </div>
  );
}
