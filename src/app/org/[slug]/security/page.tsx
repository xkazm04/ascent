// The "Security" tab — a security-first view of the fleet (Direction #2 phase 1): the Security (D9)
// dimension across repos, branch-protection/governance coverage, and a security "Copy for LLM"
// remediation brief. One dense risk register (score → drill-in modal, gate verdict, branch rules,
// advisories) replaces the former stack of single-purpose cards; every repo listed links to its
// follow-up (report, GitHub branch settings, Dependabot).

import { buildSecurityOverview, securityMarkdown } from "@/lib/org/security";
import { getOrgSupplyChain } from "@/lib/security/supply-chain";
import { Card, InlineEmpty, Meter, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
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
    getOrgSupplyChain(slug),
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
          description={`Where the fleet stands on Security (${sec.dimLabel}, D9) and default-branch governance. Click any score in the register for that repo's evaluation and next steps, or copy the remediation brief into Claude Code.`}
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
          title="Risk register"
          description={`All ${sec.scanned} scanned repos against the security gate — Security (D9) ≥ ${gate.minSecurity} and no "ungoverned" posture. Failing repos first.`}
          right={<CopyForLlm text={gateSnippet} label="Copy CI gate snippet" />}
        />
        <SecurityRiskRegister
          org={slug}
          rows={sec.register}
          advisories={supplyOn ? supply!.repos.map((r) => ({ fullName: r.fullName, critical: r.critical, high: r.high, total: r.total })) : null}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Governance coverage" />
          {!gov ? (
            <InlineEmpty>Governance needs a GitHub token/App to read branch protection. Connect it to see coverage.</InlineEmpty>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                <GovRow label="Protected branch" rate={gov.protectedRate} />
                <GovRow label="Requires review" rate={gov.requireReviewRate} />
                <GovRow label="Requires status checks" rate={gov.requireChecksRate} />
                <GovRow label="Requires signed commits" rate={gov.signedRate} />
              </div>
              {sec.unprotected.length > 0 && (
                <div className="mt-4 border-t border-slate-800 pt-3">
                  <div className="font-mono text-sm uppercase tracking-widest text-orange-300">No branch protection</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sec.unprotected.map((r) => (
                      <a
                        key={r.fullName}
                        href={`https://github.com/${r.fullName}/settings/branches`}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring rounded-md border border-orange-500/30 bg-orange-500/5 px-2 py-1 font-mono text-sm text-orange-200 transition hover:border-orange-400 hover:text-white"
                        title={`Open ${r.fullName}'s branch-protection settings on GitHub`}
                      >
                        {r.name} ↗
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        <Card>
          <SectionHeader
            size="sm"
            title="Supply chain"
            description={
              supplyOn
                ? `Open Dependabot advisories across ${supply!.scanned} repos.${supply!.demo ? " Demo data — set SUPPLY_CHAIN_PROVIDER=github for live alerts." : ""}`
                : "Open Dependabot advisories per repo — a separate signal that does NOT change the Security (D9) score."
            }
          />
          {supplyOn ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <SevChip label="Critical" n={supply!.totals.critical} color="#dc2626" />
                <SevChip label="High" n={supply!.totals.high} color="#d97706" />
                <SevChip label="Medium" n={supply!.totals.medium} color="#ca8a04" />
                <SevChip label="Low" n={supply!.totals.low} color="#64748b" />
              </div>
              {supply!.repos.filter((r) => r.total > 0).length > 0 && (
                <ul className="mt-3 space-y-1">
                  {supply!.repos.filter((r) => r.total > 0).slice(0, 8).map((r) => (
                    <li key={r.fullName} className="flex items-center justify-between gap-3 text-sm">
                      <a
                        href={`https://github.com/${r.fullName}/security/dependabot`}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring min-w-0 truncate font-mono text-slate-300 transition hover:text-white"
                        title={`Open ${r.fullName}'s Dependabot alerts on GitHub`}
                      >
                        {r.name} ↗
                      </a>
                      <span className="shrink-0 font-mono text-sm text-slate-400">
                        {r.critical > 0 ? <span className="text-red-300">{r.critical}C </span> : null}
                        {r.high > 0 ? <span className="text-orange-300">{r.high}H </span> : null}
                        {r.total} total
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            /* When supply-chain scanning is OFF (or no advisory data yet) say so — the tab must not
               look like it simply lacks the feature (Nadia). A separate signal from the D9 score. */
            <InlineEmpty>
              {(process.env.SUPPLY_CHAIN_PROVIDER ?? "off").toLowerCase() === "off"
                ? 'Supply-chain scanning isn’t enabled. Set SUPPLY_CHAIN_PROVIDER=github (live — needs the GitHub App’s "Dependabot alerts: read") or =mock (demo data) to surface advisory counts here.'
                : "No Dependabot advisory data for scanned repos yet — re-scan with the supply-chain provider configured."}
            </InlineEmpty>
          )}
        </Card>
      </div>
    </div>
  );
}

function SevChip({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <span className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-1.5 font-mono text-sm" style={{ color: n > 0 ? color : "#64748b" }}>
      {n} {label}
    </span>
  );
}

function GovRow({ label, rate }: { label: string; rate: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-44 shrink-0 text-slate-400">{label}</span>
      <Meter className="flex-1" value={rate} color={scoreHex(rate)} />
      <span className="w-9 text-right font-mono tabular-nums text-slate-300">{rate}%</span>
    </div>
  );
}
