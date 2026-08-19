// Org dashboard "Security" tab — a security-first view of the fleet (Direction #2 phase 1): the
// Security (D9) dimension across repos plus a security "Copy for LLM" remediation brief. The whole
// tab is now ONE dense risk register (score → drill-in modal, gate verdict, branch rules, advisories,
// and the specific per-repo findings the scan flagged); the former Governance-coverage and
// Supply-chain cards were folded into the register's columns and removed.
//
// Migrated onto the org tab shell (docs/ORG-TABS-REFACTOR.md):
//   - SERVER component, filename PINNED as `SecurityTab.tsx`; takes `slug` + the resolved `sp` as
//     props since it is no longer a route.
//   - Does NO auth work: the org layout's `canReadOrg` gate already ran.
//   - Its old route (src/app/org/[slug]/security/page.tsx) is now a redirect(); links already sitting
//     in digest emails and /report/... permalinks still resolve to it.

import { buildGateSnippet, buildSecurityOverview, securityMarkdown } from "@/lib/org/security";
import { getOrgSupplyChain } from "@/lib/security/supply-chain";
import { Card, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { DownloadButton } from "@/components/report/DownloadButton";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { SecurityBandSpectrum } from "./SecurityBandSpectrum";
import { SecurityRiskRegister } from "./SecurityRiskRegister";
import { SecurityFindings } from "@/components/org/SecurityFindings";
import { PersonalSecurity } from "@/components/org/PersonalSecurity";
import { isPersonalOrg } from "@/lib/db";
import { decisionMap } from "@/lib/org/decision-map";
import { resolveStackScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { scoreHex } from "@/lib/ui";
import { chipButtonClass } from "@/components/ui";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function SecurityTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // A PERSONAL workspace gets the lens edition: watched repos' D9 from the public corpus, with the
  // same decidable-findings list writing decisions to the viewer's own org (see PersonalSecurity).
  if (await isPersonalOrg(slug)) return <PersonalSecurity slug={slug} />;

  const period = await resolveOrgWindow(sp);
  // Optional tech-stack scope (Feature 3b): "Frontend security vs Backend" — scope the whole overview.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const [sec, supply, decisions] = await Promise.all([
    buildSecurityOverview(slug, { start: period.start, end: period.end }, period.title, techGroupId),
    getOrgSupplyChain(slug, techGroupId),
    decisionMap(slug, "security"),
  ]);

  if (!sec) {
    return <SectionEmpty>No scanned repositories yet. Scan some of this org&apos;s repos to assess security.</SectionEmpty>;
  }

  const md = securityMarkdown(sec, supply);
  const atRisk = sec.band.critical + sec.band.weak;
  const gov = sec.governance;
  const gate = sec.securityGate;
  // Concrete, paste-ready CI enforcement for THIS fleet — built from the FULL register (never the
  // display-capped failingRepos, which silently dropped every failing repo past 8). See buildGateSnippet.
  const gateSnippet = buildGateSnippet(sec);
  const supplyOn = !!supply && supply.scanned > 0;
  // getOrgSupplyChain returns `degraded: true` with `scanned: 0` when the advisory fetch failed (GitHub
  // auth/token failure), precisely so the caller does not mistake it for "no advisories". Nothing read
  // that flag: `supplyOn` is false either way, `advisories` is passed as null, and the register renders
  // a clean supply chain. A security view that reports "clean" when it could not look is the most
  // dangerous false signal it can emit — surface it.
  const supplyDegraded = !!supply?.degraded;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Title only. The three-sentence standfirst that used to sit here (what the score is
            evidenced from, how it is computed, that a score is clickable) restated what the Control
            matrix caption below already says, one screenful above the thing it describes — so it
            pushed the tiles down on every visit and was read on none. */}
        <SectionHeader title="Security" />
        <div className="flex flex-wrap items-center gap-2">
          <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
          {/* Fetch-and-download (not a bare anchor): the PDF render is slow and error branches return
              JSON — a plain <a> navigated the user onto a raw JSON page on failure (pdf-llm-export #1). */}
          <DownloadButton
            href={`/api/org/security/pdf?org=${encodeURIComponent(slug)}&range=${period.key}${period.from ? `&from=${encodeURIComponent(period.from)}` : ""}${period.to ? `&to=${encodeURIComponent(period.to)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`}
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
          delta={sec.securityDelta}
          deltaLabel={period.comparisonLabel}
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
        {/* The caption is rendered as a sibling, NOT through SectionHeader's `description`. That slot
            is a lede — capped at max-w-2xl, which is right for prose but wrapped this one into four
            short lines against a card that is three times as wide. Passing `descriptionClassName` a
            competing max-width would be a cascade coin-flip (two utilities of equal specificity, order
            decided by Tailwind's emission, not by the class list), so the caption owns its own <p>
            below the header row and runs the full width of the card. */}
        <SectionHeader size="sm" title="Control matrix" right={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />} />
        <p className="mb-3 mt-2 text-base text-slate-400">
          All {sec.scanned} scanned repos against the security gate (D9 ≥ {gate.minSecurity}, not &ldquo;ungoverned&rdquo;), each
          graded 0–10 across the deterministic control battery + current vuln exposure. Failing repos first; ┃ divides
          posture from exposure.
        </p>
        {supplyDegraded && (
          <p role="status" className="mb-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">
            Vulnerability advisories couldn&apos;t be fetched for this org, so the exposure columns below are
            blank. That is <strong>not</strong> a clean bill of health. Re-check the GitHub App installation
            and its security-advisory access, then reload.
          </p>
        )}
        <SecurityRiskRegister
          org={slug}
          rows={sec.register}
          advisories={supplyOn ? supply!.repos.map((r) => ({ fullName: r.fullName, critical: r.critical, high: r.high, total: r.total })) : null}
          // security-posture-audit-log #3: the mock provider's honesty flag was wired into the
          // markdown brief ("Dependabot — demo data") but never the on-screen register, so fabricated
          // counts rendered as fleet fact with live GitHub links. Label + de-link them.
          advisoriesDemo={supplyOn ? supply!.demo : false}
        />
        {/* The grid says which controls fail; this is where you decide what to do about each one. */}
        <SecurityFindings org={slug} rows={sec.register} decisions={decisions} />
      </Card>
    </div>
  );
}
