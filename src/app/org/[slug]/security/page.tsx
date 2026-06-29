// The "Security" tab — a security-first view of the fleet (Direction #2 phase 1): the Security (D9)
// dimension across repos, branch-protection/governance coverage, the weakest repos, and a security
// "Copy for LLM" remediation brief. Pure assembly of existing aggregates (rollup D9 + governance).

import { buildSecurityOverview, securityMarkdown } from "@/lib/org/security";
import { getOrgSupplyChain } from "@/lib/security/supply-chain";
import { Card, InlineEmpty, Meter, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { resolveStackScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

const BAND_COLOR = { critical: "#dc2626", weak: "#d97706", ok: "#3b9eff", strong: "#16a34a" } as const;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Security"
          description={`Where the fleet stands on Security (${sec.dimLabel}, D9) and default-branch governance — the weakest repos and the protection gaps. Copy the remediation brief into Claude Code to act on it.`}
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
        />
        <Tile
          label="Branch protection"
          value={gov ? `${gov.protectedRate}%` : "—"}
          sub={gov ? `${gov.repos} repos with rules` : "no governance data"}
          color={gov ? scoreHex(gov.protectedRate) : undefined}
        />
        <Tile label="Repos at risk" value={atRisk} sub="critical + weak (D9 < 60)" color={atRisk > 0 ? "#d97706" : "#16a34a"} />
        <Tile label="Repos scanned" value={sec.scanned} />
      </div>

      <Card>
        <SectionHeader size="sm" title="Security distribution" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["critical", "weak", "ok", "strong"] as const).map((k) => (
            <div key={k} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: BAND_COLOR[k] }}>{sec.band[k]}</div>
              <div className="mt-0.5 font-mono text-sm capitalize text-slate-400">{k}</div>
              <div className="font-mono text-sm text-slate-600">
                {k === "critical" ? "<40" : k === "weak" ? "40–59" : k === "ok" ? "60–79" : "80+"}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader
          size="sm"
          title="Security gate"
          description={`Security (D9) ≥ ${sec.securityGate.minSecurity} and no "ungoverned" posture. Enforce in CI: /api/gate/owner/repo?security=1`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-sm text-emerald-300">
            {sec.securityGate.passing} pass
          </span>
          <span
            className={`rounded-md border px-3 py-1.5 font-mono text-sm ${
              sec.securityGate.failing > 0 ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-slate-700 text-slate-400"
            }`}
          >
            {sec.securityGate.failing} fail
          </span>
        </div>
        {sec.securityGate.failingRepos.length > 0 && (
          <ul className="mt-3 space-y-1">
            {sec.securityGate.failingRepos.map((r) => (
              <li key={r.fullName} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-mono text-slate-300" title={r.fullName}>{r.name}</span>
                <span className="shrink-0 font-mono text-sm text-red-300">{r.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {supply && supply.scanned > 0 && (
        <Card>
          <SectionHeader
            size="sm"
            title="Supply chain"
            description={`Open Dependabot advisories across ${supply.scanned} repos.${supply.demo ? " Demo data — set SUPPLY_CHAIN_PROVIDER=github for live alerts." : ""}`}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <SevChip label="Critical" n={supply.totals.critical} color="#dc2626" />
            <SevChip label="High" n={supply.totals.high} color="#d97706" />
            <SevChip label="Medium" n={supply.totals.medium} color="#ca8a04" />
            <SevChip label="Low" n={supply.totals.low} color="#64748b" />
          </div>
          {supply.repos.filter((r) => r.total > 0).length > 0 && (
            <ul className="mt-3 space-y-1">
              {supply.repos.filter((r) => r.total > 0).slice(0, 8).map((r) => (
                <li key={r.fullName} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono text-slate-300" title={r.fullName}>{r.name}</span>
                  <span className="shrink-0 font-mono text-sm text-slate-400">
                    {r.critical > 0 ? <span className="text-red-300">{r.critical}C </span> : null}
                    {r.high > 0 ? <span className="text-orange-300">{r.high}H </span> : null}
                    {r.total} total
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Degraded: a github-mode run couldn't authenticate (no install / token mint failed). scanned:0
          here means "couldn't reach GitHub", NOT "clean / not enabled" — say so explicitly so a transient
          blip isn't read as an all-clear, and do not fall through to the "not enabled" empty card. */}
      {supply?.degraded && (
        <Card>
          <SectionHeader
            size="sm"
            title="Supply chain"
            description="Open Dependabot advisories per repo — a separate signal that does NOT change the Security (D9) score."
          />
          <InlineEmpty>
            Couldn’t load Dependabot advisories right now — the GitHub App installation or token was
            unavailable for this request. This is NOT an all-clear; reload in a minute to retry.
          </InlineEmpty>
        </Card>
      )}

      {/* Empty state (Nadia): when supply-chain scanning is OFF (or no advisory data yet) the card above
          silently vanished — so the tab looked like it simply had no supply-chain feature. Say so, and
          reinforce that this is a SEPARATE signal that does not change the D9 score. */}
      {!(supply && supply.scanned > 0) && !supply?.degraded && (
        <Card>
          <SectionHeader
            size="sm"
            title="Supply chain"
            description="Open Dependabot advisories per repo — a separate signal that does NOT change the Security (D9) score."
          />
          <InlineEmpty>
            {(process.env.SUPPLY_CHAIN_PROVIDER ?? "off").toLowerCase() === "off"
              ? 'Supply-chain scanning isn’t enabled. Set SUPPLY_CHAIN_PROVIDER=github (live — needs the GitHub App’s "Dependabot alerts: read") or =mock (demo data) to surface advisory counts here.'
              : "No Dependabot advisory data for scanned repos yet — re-scan with the supply-chain provider configured."}
          </InlineEmpty>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Weakest on security" />
          {sec.weakest.length === 0 ? (
            <InlineEmpty>No scored repos.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-1.5">
              {sec.weakest.map((r) => (
                <div key={r.fullName} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate text-slate-300" title={r.fullName}>{r.name}</span>
                  <Meter className="flex-1" value={r.score} color={scoreHex(r.score)} />
                  <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(r.score) }}>{r.score}</span>
                  {!r.protected && <span className="shrink-0 font-mono text-sm text-orange-300" title="No default-branch protection">⚠</span>}
                </div>
              ))}
            </div>
          )}
        </Card>

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
                      <span key={r.fullName} className="rounded-md border border-orange-500/30 bg-orange-500/5 px-2 py-1 font-mono text-sm text-orange-200" title={r.fullName}>
                        {r.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
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
