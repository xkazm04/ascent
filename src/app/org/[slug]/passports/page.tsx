// /org/[slug]/passports — the fleet App Readiness Passport portfolio (P3). The view neither the agent
// manifest nor a CI badge can give: every scanned repo's two readiness axes side by side, so the
// "automatable but not production-ready" gap (and its opposite) is visible at a glance. A sortable table
// + the automation×production scatter, scoped by the same ?segment=/?stack= filters as the rest of the
// dashboard. Passports come from scans (P1), so a never-scanned / pre-passport repo simply isn't listed.

import { SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { PassportScatter, type ScatterPoint } from "@/components/org/PassportScatter";
import { PassportTable, type PassportRow } from "@/components/org/PassportTable";
import { getOrgRollup } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";

export const dynamic = "force-dynamic";

export default async function OrgPassports({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);
  const rollup = await getOrgRollup(slug, undefined, segmentId, techGroupId);

  const withPassport = (rollup?.repos ?? []).filter((r) => r.passport);
  const rows: PassportRow[] = withPassport.map((r) => {
    const pp = r.passport!;
    return {
      fullName: r.fullName,
      name: r.name,
      autoLevel: pp.automationReadiness.level,
      autoScore: pp.automationReadiness.score,
      band: pp.productionReadiness.band,
      prodScore: pp.productionReadiness.score,
      ci: pp.productionReadiness.ci.level,
      tests: pp.productionReadiness.tests.level,
      security: pp.productionReadiness.security.level,
      observability: pp.productionReadiness.observability.level,
    };
  });
  const points: ScatterPoint[] = rows.map((r) => ({ name: r.name, x: r.autoScore, y: r.prodScore, band: r.band }));

  // Headline counts — the portfolio's shape at a glance.
  const prodReady = rows.filter((r) => r.band === "production" || r.band === "hardened").length;
  const gap = rows.filter((r) => r.autoScore >= 65 && r.prodScore < 65).length; // automatable, not prod-ready
  const noObs = rows.filter((r) => r.observability === "none").length;

  // `gate={false}` keeps the bar's wrapper rendering even when neither selector has options, matching
  // the previous inline markup exactly (the default className is ScopeFilterBar's own default).
  const scopeBar = <ScopeFilterBar {...barProps} gate={false} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Readiness passports"
          description="Each scanned repo's two readiness axes — ready for full LLM automation, and ready for production — side by side. Spot the gap that matters: automatable but not production-ready, or the reverse."
        />
        {scopeBar}
      </div>

      {rows.length === 0 ? (
        <SectionEmpty>
          No passports yet for this view. Passports are produced by scans — scan some of this org&apos;s repositories (or widen the segment / stack filter), and each scan adds its repo here.
        </SectionEmpty>
      ) : (
        <>
          <div className={TILE_GRID}>
            <Tile label="Passports" value={rows.length} sub={`of ${(rollup?.repos ?? []).length} repos`} />
            <Tile label="Production-ready" value={prodReady} sub="production or hardened band" color={prodReady > 0 ? "#16a34a" : undefined} />
            <Tile label="Automatable, not prod-ready" value={gap} sub="automation ≥65 · production <65" color={gap > 0 ? "#d97706" : undefined} />
            <Tile label="No observability" value={noObs} sub="zero error tracking / logs" color={noObs > 0 ? "#f97316" : undefined} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-divider bg-surface/40 p-4">
              <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Automation × Production</div>
              <PassportScatter points={points} />
            </div>
            <PassportTable rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
