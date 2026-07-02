// The "Briefing" tab — an exec-grade summary that assembles maturity, corpus benchmark, trajectory,
// movement and goals into one board-ready narrative, with a "Copy briefing for LLM" action that emits
// a markdown brief to paste into Claude Code (Direction #5 + the #6 LLM-consumption baseline).

import Link from "next/link";
import { buildExecBriefing, briefingMarkdown, engineMixLabel, engineMixDegraded, valueRealizedLine } from "@/lib/org/briefing";
import { Card, InlineEmpty, Meter, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { DimRow, MoveRow, PriorPeriodGrid, practiceHref } from "@/components/org/briefingShared";
import { CopyForLlm } from "@/components/CopyForLlm";
import { BriefingShareButton } from "@/components/org/BriefingShareButton";
import { BrandingSettings } from "@/components/org/BrandingSettings";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { OrgLeverageMoves } from "@/components/org/OrgLeverageMoves";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { getCreditState, getOrgBranding, getOrgRecommendations } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { hasOrgRole } from "@/lib/authz";
import { resolveOrgWindow } from "@/lib/org/period";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function OrgExecutive({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const period = await resolveOrgWindow(sp);
  // ?segment=<id> scopes the whole briefing to one segment (a reseller's per-client view).
  const segmentId = typeof sp.segment === "string" ? sp.segment : null;
  // ?stack=<key> scopes the whole briefing to one tech-stack group (Feature 3b) — a per-stack briefing.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const briefing = await buildExecBriefing(slug, { start: period.start, end: period.end }, period.title, segmentId, techGroupId);

  if (!briefing) {
    return (
      <SectionEmpty>
        No scanned repositories yet — scan some of this org&apos;s repos to generate an executive briefing.
      </SectionEmpty>
    );
  }

  // Highest-leverage fleet moves — the ranked, projected-gain recommendations. Moved here from the
  // Overview so the Briefing owns the "what to do next" narrative (it supersedes the old single
  // "Recommended next move" line below). Scoped to the same segment/stack as the rest of the briefing.
  const orgRecs = await getOrgRecommendations(slug, 5, segmentId, techGroupId).catch(() => null);

  const md = briefingMarkdown(briefing);
  const { maturity, benchmark } = briefing;
  // EXEC-6/EXEC-5: owner-gated sharing + (enterprise) white-label. One ownership check feeds both.
  const isOwner = await hasOrgRole(slug, "owner");
  const canShare = briefingShareEnabled() && isOwner;
  const [branding, credit] = isOwner
    ? await Promise.all([getOrgBranding(slug).catch(() => null), getCreditState(slug).catch(() => null)])
    : [null, null];
  const canBrand = isOwner && planAllowsWhiteLabel(credit?.plan);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Executive briefing"
          description={`Board-ready standing for ${slug} — maturity, benchmark, trajectory, movement and goals over ${period.title.toLowerCase()}. Copy it as a markdown brief to drop into Claude Code for next actions.`}
        />
        <div className="flex flex-wrap items-center gap-2">
          {techGroups.length > 0 && <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />}
          <a
            // EXEC #1: carry the active ?segment= (and the ?stack= tech scope, 3b) into the export so a
            // per-client / per-stack briefing downloads the SAME scope being viewed, not the whole org.
            href={`/api/org/briefing/pdf?org=${encodeURIComponent(slug)}&range=${period.key}${period.from ? `&from=${encodeURIComponent(period.from)}` : ""}${period.to ? `&to=${encodeURIComponent(period.to)}` : ""}${segmentId ? `&segment=${encodeURIComponent(segmentId)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-accent hover:text-white"
            title="Download the briefing as a board-ready PDF"
          >
            <span aria-hidden>↓</span> Download PDF
          </a>
          {/* EXEC #1: carry the active segment + tech-stack scope into the share link too, so the
              read-only board link re-runs scoped to the same view the owner is sharing. */}
          {canShare && <BriefingShareButton org={slug} range={period.key} from={period.from} to={period.to} segment={segmentId} stack={activeStack?.key ?? null} />}
          <CopyForLlm text={md} label="Copy briefing for LLM" />
        </div>
      </div>

      <div className={TILE_GRID}>
        <Tile
          label="Org maturity"
          value={maturity.overall}
          sub={`${maturity.levelId} · ${maturity.levelName}`}
          color={scoreHex(maturity.overall)}
          delta={briefing.periodDelta ?? undefined}
          deltaLabel={period.comparisonLabel}
        />
        <Tile label="AI Adoption" value={maturity.adoption} color={scoreHex(maturity.adoption)} />
        <Tile label="Engineering Rigor" value={maturity.rigor} color={scoreHex(maturity.rigor)} />
        <Tile
          label="Corpus percentile"
          value={benchmark?.percentile != null ? `${benchmark.percentile}` : "—"}
          sub={benchmark && benchmark.corpusRepos > 0 ? `vs ${benchmark.corpusRepos} repos` : "no corpus yet"}
          color={benchmark?.percentile != null ? scoreHex(benchmark.percentile) : undefined}
        />
      </div>

      {valueRealizedLine(briefing.valueRealized) && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
          <span className="font-mono text-sm uppercase tracking-widest text-accent">Value this period</span>{" "}
          <span className="text-base text-slate-200">{valueRealizedLine(briefing.valueRealized)}</span>
        </div>
      )}

      {/* GB: fleet signals as ONE wrap-row strip instead of three stacked <p> lines. */}
      {(briefing.adoptionRate != null ||
        briefing.movement.compared > 0 ||
        benchmark?.cohort?.overallPercentile != null ||
        briefing.engineMix.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-sm text-slate-500">
          {briefing.adoptionRate != null && (
            <span>
              Fleet adoption <span className="text-slate-300">{briefing.adoptionRate}%</span> at high-adoption posture
            </span>
          )}
          {briefing.movement.compared > 0 && (
            <span>
              <span className="text-slate-300">{briefing.movement.up + briefing.movement.down}</span> of{" "}
              {briefing.movement.compared} repos moved ({briefing.movement.up}▲ / {briefing.movement.down}▼)
            </span>
          )}
          {benchmark?.cohort?.overallPercentile != null && (
            <span>
              Peer cohort <span className="text-slate-300">{benchmark.cohort.overallPercentile}th percentile</span> vs{" "}
              {benchmark.cohort.repos} {benchmark.cohort.language} repos
              {benchmark.cohort.adoptionPercentile != null ? ` · ${benchmark.cohort.adoptionPercentile}th on AI adoption` : ""}
            </span>
          )}
          {briefing.engineMix.length > 0 && (
            <span>
              Scored by {engineMixLabel(briefing.engineMix)}
              {engineMixDegraded(briefing.engineMix) && (
                <span className="text-warn"> · ⚠ some scores used the deterministic mock engine</span>
              )}
            </span>
          )}
        </div>
      )}

      {(briefing.forecastHeadline || briefing.regressionCount > 0) && (
        <Card>
          <SectionHeader size="sm" title="Trajectory" />
          <p className="mt-2 text-base text-slate-300">
            {briefing.forecastHeadline ?? "Not enough history yet to project a trajectory."}
          </p>
          {briefing.forecastHeadline && briefing.forecastConfidence != null && (
            <p className="mt-1 font-mono text-sm text-slate-500">
              trend confidence {briefing.forecastConfidence}%{briefing.forecastConfidence < 50 ? " · noisy" : ""}
            </p>
          )}
          {briefing.regressionCount > 0 && (
            <p className="mt-1 font-mono text-sm text-orange-300">
              ⚠ {briefing.regressionCount} repo{briefing.regressionCount > 1 ? "s" : ""} regressed{" "}
              {period.start ? "this period" : "since last scan"}.
            </p>
          )}
        </Card>
      )}

      {briefing.priorPeriod && (
        <Card>
          <SectionHeader size="sm" title="vs previous period" description="This period's end state against the equal-length window before it." />
          <PriorPeriodGrid prior={briefing.priorPeriod} now={maturity} showDimensions />
        </Card>
      )}

      {/* Highest-leverage moves — the ranked "what to do next", replacing the old single-line
          "Recommended next move" (which named only the weakest dimension). */}
      {orgRecs && orgRecs.length > 0 && <OrgLeverageMoves recs={orgRecs} slug={slug} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Strengths" />
          <div className="mt-3 space-y-1.5">
            {briefing.strengths.map((d) => (
              <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} href={practiceHref(slug, d.dimId)} />
            ))}
          </div>
        </Card>
        <Card>
          <SectionHeader size="sm" title="Weakest dimensions" right={<span className="font-mono text-sm text-slate-500">→ practices</span>} />
          <div className="mt-3 space-y-1.5">
            {briefing.risks.map((d) => (
              <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} href={practiceHref(slug, d.dimId)} />
            ))}
            {briefing.security && briefing.risks.every((r) => r.dimId !== "D9") && (
              <DimRow
                dimId={briefing.security.dimId}
                label={`${briefing.security.label} (security)`}
                avg={briefing.security.avg}
                href={practiceHref(slug, briefing.security.dimId)}
              />
            )}
          </div>
        </Card>
      </div>

      {(briefing.topGainers.length > 0 || briefing.topRegressions.length > 0) && (
        <Card>
          <SectionHeader size="sm" title="Movement this period" />
          <div className="mt-3 space-y-1.5">
            {briefing.topGainers.map((m) => (
              <MoveRow key={`g-${m.name}`} tone="up" name={m.name} fullName={m.fullName} d={m.dOverall} from={m.levelFrom} to={m.levelTo} />
            ))}
            {briefing.topRegressions.map((m) => (
              <MoveRow key={`r-${m.name}`} tone="down" name={m.name} fullName={m.fullName} d={m.dOverall} from={m.levelFrom} to={m.levelTo} />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader
          size="sm"
          title="Goals"
          right={
            <Link href={`/org/${slug}/plan`} className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent">
              Manage goals →
            </Link>
          }
        />
        {briefing.goals.length === 0 ? (
          <InlineEmpty>No goals set — define maturity targets on the Plan tab to track progress here.</InlineEmpty>
        ) : (
          <div className="mt-3 space-y-2.5">
            {briefing.goals.map((g) => (
              <div key={g.label} className="flex items-center gap-3 text-base">
                <span className="min-w-0 flex-1 truncate text-slate-300">{g.label}</span>
                <Meter className="w-32 shrink-0" value={g.pct} color={scoreHex(g.pct)} />
                <span className="w-28 shrink-0 text-right font-mono text-sm text-slate-400">
                  {g.current}/{g.target}
                  {g.etaDays != null ? ` · ~${g.etaDays}d` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {canBrand && <BrandingSettings slug={slug} initial={branding ?? { brandName: null, brandColor: null, logoUrl: null }} />}
    </div>
  );
}

