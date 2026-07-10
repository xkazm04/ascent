// /org/[slug]/passports — the fleet App Readiness Passport portfolio (P3). The view neither the agent
// manifest nor a CI badge can give: every scanned repo's two readiness axes side by side, so the
// "automatable but not production-ready" gap (and its opposite) is visible at a glance. One compact
// header row (title · segment scope · CSV export), then straight into the content: the
// automation×production scatter whose quadrants are the one and only filter (click to isolate a
// cohort, ✕ to reset to all), a top-blockers docket that files GitHub issues, and a full-width table
// whose rows expand into each passport's blockers + observed facts. A ?stack= URL scope is still
// honored for data consistency with the other tabs, but this page renders no stack UI. Passports
// come from scans (P1), so a never-scanned / pre-passport repo simply isn't listed.

import { ExportCsvLink, SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { SegmentSelector } from "@/components/org/shared/SegmentSelector";
import { PassportPortfolio } from "@/components/org/passports/PassportPortfolio";
import type { PassportRow } from "@/components/org/passports/PassportTable";
import { getOrgRollup } from "@/lib/db";
import { passportStackChips } from "@/lib/org/passport-display";
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
  const { segments, segmentId, techGroupId } = await resolveOrgScope(slug, sp);
  const rollup = await getOrgRollup(slug, undefined, segmentId, techGroupId);

  const withPassport = (rollup?.repos ?? []).filter((r) => r.passport);
  // The table row carries the passport's full actionable depth (blockers, self-verify, CI/tests/
  // security/delivery facts, stack) so a row expands with zero fetches — it's all cached rollup data.
  const rows: PassportRow[] = withPassport.map((r) => {
    const pp = r.passport!;
    const auto = pp.automationReadiness;
    const prod = pp.productionReadiness;
    return {
      fullName: r.fullName,
      name: r.name,
      autoLevel: auto.level,
      autoScore: auto.score,
      band: prod.band,
      prodScore: prod.score,
      ci: prod.ci.level,
      tests: prod.tests.level,
      security: prod.security.level,
      observability: prod.observability.level,
      detail: {
        purpose: pp.identity.purpose,
        autoBlockers: auto.blockers,
        prodBlockers: prod.blockers,
        selfVerify: auto.selfVerify,
        aiInWorkflow: auto.aiInWorkflow,
        ciProvider: prod.ci.provider,
        ciGates: prod.ci.gates,
        coveragePct: prod.tests.coveragePct,
        criticalPathCovered: prod.tests.criticalPathCovered,
        securityTools: prod.security.tools,
        delivery: prod.delivery,
        stack: passportStackChips(pp),
        confidence: pp.evidence.confidence,
      },
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title="Readiness passports" />
        <div className="flex flex-wrap items-center gap-2">
          {segments.length > 0 && <SegmentSelector segments={segments} active={segmentId} />}
          {rows.length > 0 && <ExportCsvLink org={slug} kind="passports" segmentId={segmentId} className="shrink-0" />}
        </div>
      </div>

      {rows.length === 0 ? (
        <SectionEmpty>
          No passports yet for this view. Passports are produced by scans — scan some of this org&apos;s repositories (or widen the segment filter), and each scan adds its repo here.
        </SectionEmpty>
      ) : (
        <PassportPortfolio rows={rows} org={slug} />
      )}
    </div>
  );
}
