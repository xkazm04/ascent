"use client";

// v2 fleet rollup: the same grouping, filters and figures as the Altimeter card (useFleetRollup), recomposed as
// a ruled section. The mode switch is a Segmented, the shown set's summary is a row of figures with their
// denominators in the tooltip, the cohorts stack as ruled groups (one column, level-ordered when grouped by level).
import { Caption, FilterMenu, Frame, SectionHead, Segmented } from "@/components/kit";
import { deltaHex, DIRECTION_TONE, fmtDelta } from "@/components/ui/format";
import { scoreHex } from "@/lib/ui";
import { FleetGroup } from "./FleetGroup.v2";
import { MODES } from "./repoCategoryRollupLogic";
import type { RepoTrajectory } from "./repoTrajectory";
import { useFleetRollup } from "./useFleetRollup";

export function FleetRollup({ trajectories, periodTitle, orgSlug }: { trajectories: RepoTrajectory[]; periodTitle: string; orgSlug: string }) {
  const { mode, setMode, filters, toggle, clear, typeOpts, stackOpts, levelOpts, filtered, groups, active, reset, fleet } = useFleetRollup(trajectories);
  const avgTitle =
    fleet.avgOverall == null
      ? `No live-scored repositories in this set${fleet.mock > 0 ? ` (all ${fleet.mock} carry a deterministic mock score)` : ""}`
      : `Average over the ${fleet.realScored} live-scored repo${fleet.realScored === 1 ? "" : "s"}${fleet.mock > 0 ? ` · ${fleet.mock} mock placeholder${fleet.mock === 1 ? "" : "s"} excluded` : ""}`;
  return (
    <Frame>
      <SectionHead
        eyebrow="Fleet"
        title="Which kinds of repo"
        named="are moving."
        lede={`${filtered.length} repos · ${periodTitle}`}
        actions={<Segmented label="Group by" options={MODES.map((m) => ({ key: m.id, label: m.label }))} value={mode} onSelect={(k) => setMode(k as typeof mode)} />}
      />
      {filtered.length > 0 && (
        <dl data-role="fleet-summary" className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 type-body-sm text-slate-400">
          <div title={avgTitle}>
            <dt className="inline">avg </dt>
            <dd className="inline font-mono font-semibold tabular-nums" style={fleet.avgOverall == null ? undefined : { color: scoreHex(fleet.avgOverall) }}>
              {fleet.avgOverall ?? "—"}
            </dd>
          </div>
          <span className="tabular-nums" style={{ color: DIRECTION_TONE.rising.color }}>▲ {fleet.improving}</span>
          <span className="tabular-nums" style={{ color: DIRECTION_TONE.falling.color }}>▼ {fleet.slipping}</span>
          <span className="tabular-nums">→ {fleet.holding}</span>
          <div>
            <dt className="inline">avg move </dt>
            <dd className="inline font-mono font-semibold tabular-nums" style={fleet.avgMove == null ? undefined : { color: deltaHex(fleet.avgMove) }}>
              {fleet.avgMove == null ? "—" : fmtDelta(fleet.avgMove)}
            </dd>
          </div>
          {fleet.mock > 0 && <span title="Repositories still showing a deterministic mock score (excluded from the average above); re-scan live to replace">{fleet.mock} mock (excluded from avg)</span>}
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterMenu label="Type" options={typeOpts} selected={filters.types} onToggle={(v) => toggle("types", v)} onClear={() => clear("types")} />
        <FilterMenu label="Stack" options={stackOpts} selected={filters.roles} onToggle={(v) => toggle("roles", v)} onClear={() => clear("roles")} />
        <FilterMenu label="Level" options={levelOpts} selected={filters.levels} onToggle={(v) => toggle("levels", v)} onClear={() => clear("levels")} />
        {active && (
          <button type="button" onClick={reset} className="focus-ring type-caption text-slate-200 underline-offset-4 hover:underline">
            Clear · {filtered.length} of {trajectories.length}
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <Caption className="mt-6">No repositories match these filters.</Caption>
      ) : (
        groups.map((g) => <FleetGroup key={g.key} g={g} orgSlug={orgSlug} />)
      )}
    </Frame>
  );
}
