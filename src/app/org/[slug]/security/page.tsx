// The "Security" tab — a security-first view of the fleet (Direction #2 phase 1): the Security (D9)
// dimension across repos plus a security "Copy for LLM" remediation brief. The whole tab is now ONE
// dense risk register (score → drill-in modal, gate verdict, branch rules, advisories, and the
// specific per-repo findings the scan flagged); the former Governance-coverage and Supply-chain cards
// were folded into the register's columns and removed.

import { buildSecurityOverview, securityMarkdown } from "@/lib/org/security";
import { getOrgSupplyChain } from "@/lib/security/supply-chain";
import { Card, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { SecurityBandSpectrum } from "@/components/org/SecurityBandSpectrum";
import { SecurityRiskRegister } from "@/components/org/SecurityRiskRegister";
import { resolveStackScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function OrgSecurity({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const period = await resolveOrgWindow(sp);
  // Optional tech-stack scope (Feature 3b): "Frontend security vs Backend" — scope the whole overview.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const [sec, supply] = await Promise.all([
    buildSecurityOverview(slug, { start: period.start, end: period.end }, period.title, techGroupId),
    getOrgSupplyChain(slug, techGroupId),
  ]);

  if (!sec) {
    return <SectionEmpty>No scanned repositories yet — scan some of this org&apos;s repos to assess security.</SectionEmpty>;
  }

  const md = securityMarkdown(sec, supply);
  const atRisk = sec.band.critical + sec.band.weak;
  const gov = sec.governance;
  const gate = sec.securityGate;
  // Concrete, paste-ready CI enforcement for THIS fleet — failing repos first, else two examples.
  const gateSnippet = [
    `# Ascent security gate — non-zero exit when Security (D9) < ${gate.minSecurity} or the posture is "ungoverned".`,
    `# Add one line per repo to CI; set ASCENT_URL to this Ascent instance.`,
    ...(gate.failingRepos.length > 0 ? gate.failingRepos : sec.register.slice(0, 2)).map(
      (r) => `curl -sf "$ASCENT_URL/api/gate/${r.fullName}?security=1"`,
    ),
  ].join("\n");
  const supplyOn = !!supply && supply.scanned > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Security"
          description={`Security engineering evidenced from each repo + its GitHub state — NOT a guarantee the code is safe. Scored by a deterministic, Scorecard-style check battery (graded controls + current vuln exposure); the register grid shows which controls are covered, per repo. Click a score for the full per-check evidence.`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
          <a
            href={`/api/org/security/pdf?org=${encodeURIComponent(slug)}&range=${period.key}${period.from ? `&from=${encodeURIComponent(period.from)}` : ""}${period.to ? `&to=${encodeURIComponent(period.to)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-accent hover:text-white"
            title="Download the security posture as a PDF"
          >
            <span aria-hidden>↓</span> Download PDF
          </a>
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
      </div>

      <SecurityBandSpectrum band={sec.band} scanned={sec.scanned} />

      <Card>
        <SectionHeader
          size="sm"
          title="Control matrix"
          description={`All ${sec.scanned} scanned repos against the security gate (D9 ≥ ${gate.minSecurity}, not "ungoverned"), each graded 0–10 across the deterministic control battery + current vuln exposure. Failing repos first; ┃ divides posture from exposure.`}
          right={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />}
        />
        <SecurityRiskRegister
          org={slug}
          rows={sec.register}
          advisories={supplyOn ? supply!.repos.map((r) => ({ fullName: r.fullName, critical: r.critical, high: r.high, total: r.total })) : null}
        />
      </Card>
    </div>
  );
}
