// The Prism composition of the Security tab. Same SecurityTabData and the same register behaviour as v1; what
// changes is the structure: a masthead that states how many repos sit below the D9 bar (four figures beside it),
// the band spectrum as the fleet's shape, then two ruled Frames (the D9 check battery with its register, and the
// findings you decide on) instead of a tile ledger inside one card.
import { Frame, Masthead, SectionHead, type MastheadFigure } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import { DownloadButton } from "@/components/report/DownloadButton";
import { TechStackSelector } from "@/components/shared/scope/TechStackSelector";
import { SecurityFindings } from "@/components/shared/security/SecurityFindings";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { chipButtonClass } from "@/components/ui";
import { Movement } from "@/components/kit";
import { CHECK_AXES } from "./securityMatrixModel";
import { SecurityBandSpectrumV2 } from "./SecurityBandSpectrum.v2";
import { SecurityRiskRegisterV2 } from "./SecurityRiskRegister.v2";
import type { SecurityTabData } from "./securityTabData";

export function securityV2(d: SecurityTabData) {
  const { slug, sec, decisions, md, gateSnippet, advisories, advisoriesDemo, supplyDegraded, comparisonLabel, stack } = d;
  const atRisk = sec.band.critical + sec.band.weak;
  const gov = sec.governance;
  const gate = sec.securityGate;
  const figures: MastheadFigure[] = [
    {
      label: "Average security (D9)",
      value: sec.avgSecurity ?? "—",
      detail:
        sec.securityCohortSize != null ? (
          <>
            <Movement delta={sec.securityDelta} basis={comparisonLabel} />
            {sec.securityDelta ? " · " : ""}
            {sec.securityCohortSize} repo{sec.securityCohortSize === 1 ? "" : "s"}
          </>
        ) : (
          comparisonLabel
        ),
    },
    { label: "Branch protection", value: gov ? `${gov.protectedRate}%` : "—", detail: gov ? `${gov.repos} repos with rules` : "no governance data" },
    { label: "Security gate", value: gate.failing > 0 ? `${gate.failing} fail` : "all pass", tone: gate.failing > 0 ? "risk" : "good", detail: `${gate.passing} of ${sec.scanned} pass` },
  ];
  return (
    <div data-role="security-v2" className="stagger-children space-y-8">
      <Masthead
        eyebrow="Security"
        statement={atRisk > 0 ? `${atRisk} of ${sec.scanned} repos` : `${sec.scanned} repos,`}
        named={atRisk > 0 ? "sit below the security bar." : "none below the security bar."}
        lede="Security (D9) is computed from deterministic controls, not judged. Open any score for the evidence behind it."
        figures={figures}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <TechStackSelector groups={stack.groups} active={stack.active} />
            <DownloadButton href={d.pdfHref} className={chipButtonClass()} title="Download the security posture as a PDF">
              <span aria-hidden>↓</span> Download PDF
            </DownloadButton>
            <CopyForLlm text={md} label="Copy security brief for LLM" />
          </div>
        }
      />
      <SecurityBandSpectrumV2 band={sec.band} scanned={sec.scanned} />
      <Frame aria-label="D9 check battery">
        <SectionHead
          eyebrow="Control matrix"
          title="Which controls hold,"
          named="repo by repo."
          lede={`${sec.scanned} repos × ${CHECK_AXES.length} controls · gate D9 ≥ ${gate.minSecurity}`}
          actions={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />}
        />
        {supplyDegraded && (
          // DELIBERATELY NOT DEMOTED: "we could not look" is the one reading here that must never pass for a clean bill.
          <p role="status" className="mt-4 max-w-[70ch] border-l-2 border-divider pl-4 type-body-sm text-white">
            <span aria-hidden>! </span>
            Vulnerability advisories couldn&apos;t be fetched for this org, so the <strong>Advisories</strong> column below is not shown at all. That is{" "}
            <strong>not</strong> a clean bill of health. Re-check the GitHub App installation and its security-advisory access, then reload.
          </p>
        )}
        <div className="mt-5">
          <SecurityRiskRegisterV2 org={slug} rows={sec.register} advisories={advisories} advisoriesDemo={advisoriesDemo} />
        </div>
      </Frame>
      <Frame aria-label="Security findings">
        {/* The grid says which controls fail; this is where you decide what to do about each one. */}
        <SecurityFindings org={slug} rows={sec.register} decisions={decisions} />
      </Frame>
      <NextMoveLink href={orgTabHref(slug, "proposals")} to="proposals" />
    </div>
  );
}
