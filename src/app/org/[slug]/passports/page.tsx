// /org/[slug]/passports — the fleet App Readiness Passport portfolio (P3). The view neither the agent
// manifest nor a CI badge can give: every scanned repo's two readiness axes side by side, so the
// "automatable but not production-ready" gap (and its opposite) is visible at a glance. One interactive
// unit (PassportPortfolio): cohort chips that filter, the automation×production scatter with clickable
// quadrants, a top-blockers pareto ("fix once, move N repos"), and a sortable table whose rows expand
// into each passport's blockers + observed facts. Scoped by the same ?segment=/?stack= filters as the
// rest of the dashboard; exportable as CSV. Passports come from scans (P1), so a never-scanned /
// pre-passport repo simply isn't listed.

import { ExportCsvLink, SectionEmpty, SectionHeader } from "@/components/org/ui";
import { SegmentSelector } from "@/components/org/SegmentSelector";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { PassportPortfolio } from "@/components/org/PassportPortfolio";
import type { PassportRow } from "@/components/org/PassportTable";
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
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Readiness passports"
          description="Each scanned repo's two readiness axes — ready for full LLM automation, and ready for production — side by side. Click a cohort (or a scatter quadrant) to isolate it; expand a row for the blockers behind its numbers."
        />
        <div className="flex flex-wrap items-center gap-2">
          {segments.length > 0 && <SegmentSelector segments={segments} active={segmentId} />}
          <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
          {rows.length > 0 && <ExportCsvLink org={slug} kind="passports" segmentId={segmentId} className="shrink-0" />}
        </div>
      </div>

      {rows.length === 0 ? (
        <SectionEmpty>
          No passports yet for this view. Passports are produced by scans — scan some of this org&apos;s repositories (or widen the segment / stack filter), and each scan adds its repo here.
        </SectionEmpty>
      ) : (
        <PassportPortfolio rows={rows} repoTotal={(rollup?.repos ?? []).length} />
      )}
    </div>
  );
}
