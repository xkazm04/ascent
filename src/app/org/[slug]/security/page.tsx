// The "Security" tab — a security-first view of the fleet (Direction #2 phase 1): the Security (D9)
// dimension across repos, branch-protection/governance coverage, the weakest repos, and a security
// "Copy for LLM" remediation brief. Pure assembly of existing aggregates (rollup D9 + governance).

import { buildSecurityOverview, securityMarkdown } from "@/lib/org/security";
import { Card, InlineEmpty, Meter, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { resolveWindow } from "@/lib/window";
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
  const period = resolveWindow(sp);
  const sec = await buildSecurityOverview(slug, { start: period.start, end: period.end }, period.title);

  if (!sec) {
    return <SectionEmpty>No scanned repositories yet — scan some of this org&apos;s repos to assess security.</SectionEmpty>;
  }

  const md = securityMarkdown(sec);
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
        <CopyForLlm text={md} label="Copy security brief for LLM" />
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

function GovRow({ label, rate }: { label: string; rate: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-44 shrink-0 text-slate-400">{label}</span>
      <Meter className="flex-1" value={rate} color={scoreHex(rate)} />
      <span className="w-9 text-right font-mono tabular-nums text-slate-300">{rate}%</span>
    </div>
  );
}
