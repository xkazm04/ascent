// The "Briefing" tab — an exec-grade summary that assembles maturity, corpus benchmark, trajectory,
// movement and goals into one board-ready narrative, with a "Copy briefing for LLM" action that emits
// a markdown brief to paste into Claude Code (Direction #5 + the #6 LLM-consumption baseline).

import { buildExecBriefing, briefingMarkdown, engineMixLabel, engineMixDegraded, valueRealizedLine } from "@/lib/org/briefing";
import { Card, InlineEmpty, Meter, SectionEmpty, SectionHeader, Tile, TILE_GRID, DIRECTION_TONE } from "@/components/org/ui";
import { DimRow, PriorPeriodGrid } from "@/components/org/briefingShared";
import { CopyForLlm } from "@/components/CopyForLlm";
import { BriefingShareButton } from "@/components/org/BriefingShareButton";
import { BrandingSettings } from "@/components/org/BrandingSettings";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { getCreditState, getOrgBranding } from "@/lib/db";
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

      {(briefing.adoptionRate != null || briefing.movement.compared > 0) && (
        <p className="font-mono text-sm text-slate-500">
          {briefing.adoptionRate != null && (
            <>
              Fleet adoption <span className="text-slate-300">{briefing.adoptionRate}%</span> at high-adoption posture
            </>
          )}
          {briefing.movement.compared > 0 && (
            <>
              {briefing.adoptionRate != null ? " · " : ""}
              <span className="text-slate-300">{briefing.movement.up + briefing.movement.down}</span> of{" "}
              {briefing.movement.compared} repos moved ({briefing.movement.up}▲ / {briefing.movement.down}▼)
            </>
          )}
        </p>
      )}

      {benchmark?.cohort?.overallPercentile != null && (
        <p className="-mt-2 font-mono text-sm text-slate-500">
          Peer cohort:{" "}
          <span className="text-slate-300">{benchmark.cohort.overallPercentile}th percentile</span> vs{" "}
          {benchmark.cohort.repos} {benchmark.cohort.language} repos
          {benchmark.cohort.adoptionPercentile != null ? ` · ${benchmark.cohort.adoptionPercentile}th on AI adoption` : ""}
        </p>
      )}

      {briefing.engineMix.length > 0 && (
        <p className="font-mono text-sm text-slate-500">
          Scored by {engineMixLabel(briefing.engineMix)}
          {engineMixDegraded(briefing.engineMix) && (
            <span className="text-warn">
              {" "}· ⚠ some scores this period used the deterministic mock engine, not the live model
            </span>
          )}
        </p>
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

      {(briefing.risks[0] ?? briefing.security) && (
        <Card>
          <SectionHeader size="sm" title="Recommended next move" />
          {(() => {
            const focus = briefing.risks[0] ?? briefing.security!;
            return (
              <p className="mt-2 text-base text-slate-300">
                Raise{" "}
                <span className="font-semibold text-white">
                  {focus.dimId} {focus.label}
                </span>{" "}
                — the fleet&apos;s weakest dimension at{" "}
                <span style={{ color: scoreHex(focus.avg) }}>{focus.avg}/100</span>. It carries the most
                headroom, so closing it is the highest-leverage lift toward the next maturity level.
              </p>
            );
          })()}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Strengths" />
          <div className="mt-3 space-y-1.5">
            {briefing.strengths.map((d) => (
              <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} />
            ))}
          </div>
        </Card>
        <Card>
          <SectionHeader size="sm" title="Weakest dimensions" />
          <div className="mt-3 space-y-1.5">
            {briefing.risks.map((d) => (
              <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} />
            ))}
            {briefing.security && briefing.risks.every((r) => r.dimId !== "D9") && (
              <DimRow dimId={briefing.security.dimId} label={`${briefing.security.label} (security)`} avg={briefing.security.avg} />
            )}
          </div>
        </Card>
      </div>

      {(briefing.topGainers.length > 0 || briefing.topRegressions.length > 0) && (
        <Card>
          <SectionHeader size="sm" title="Movement this period" />
          <div className="mt-3 space-y-1.5">
            {briefing.topGainers.map((m) => (
              <MoveRow key={`g-${m.name}`} tone="up" name={m.name} d={m.dOverall} from={m.levelFrom} to={m.levelTo} />
            ))}
            {briefing.topRegressions.map((m) => (
              <MoveRow key={`r-${m.name}`} tone="down" name={m.name} d={m.dOverall} from={m.levelFrom} to={m.levelTo} />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader size="sm" title="Goals" />
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

function MoveRow({ tone, name, d, from, to }: { tone: "up" | "down"; name: string; d: number; from: string; to: string }) {
  const { arrow, color } = DIRECTION_TONE[tone === "up" ? "rising" : "falling"];
  return (
    <div className="flex items-center justify-between gap-3 text-base">
      <span className="min-w-0 truncate font-mono text-sm text-slate-200">{name}</span>
      <span className="flex shrink-0 items-center gap-2 font-mono text-sm">
        {from !== to && <span className="text-slate-500">{from}→{to}</span>}
        <span style={{ color }}>
          {arrow} {Math.abs(d)}
        </span>
      </span>
    </div>
  );
}
