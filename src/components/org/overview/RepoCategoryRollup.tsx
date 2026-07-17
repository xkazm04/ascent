"use client";

// Category Rollup — the Overview repos×time view. Repositories grouped by a switchable dimension —
// Type (posture) · Stack (role) · Level — each group carrying its own aggregates (count · avg maturity ·
// net move) above its rows. Filtering lives in the header dropdowns (Type / Stack / Level), not a top
// selector row. The organisational lens: "which KINDS of repos are strong or slipping?"

import { useState } from "react";
import Link from "next/link";
import { Surface } from "@/components/ui";
import { SectionHeader, Meter, postureLabel } from "@/components/org/shared/ui";
import { fmtDelta, deltaHex, DIRECTION_TONE } from "@/components/ui/format";
import { scoreHex, LEVEL_CLASSES, LEVEL_GLYPH, reportPermalink, freshness } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { StackRoleIcon } from "@/components/org/overview/orgIcons";
import { FilterMenu, type FilterOption } from "@/components/org/overview/FilterMenu";
import {
  applyFilters,
  emptyFilters,
  filtersActive,
  posturesPresent,
  rolesPresent,
  levelsPresent,
  rolesOf,
  isMockEngine,
  summarize,
  avgRealMove,
  POSTURE_DOT,
  POSTURE_DOT_FALLBACK,
  STACK_ROLE_LABEL,
  type RepoTrajectory,
  type RepoFilters,
} from "@/components/org/overview/repoTrajectory";

type Mode = "type" | "stack" | "level";
const MODES: { id: Mode; label: string }[] = [
  { id: "type", label: "Type" },
  { id: "stack", label: "Stack" },
  { id: "level", label: "Level" },
];

const dot = (p: string) => <span className="h-2 w-2 rounded-full" style={{ backgroundColor: POSTURE_DOT[p] ?? POSTURE_DOT_FALLBACK }} />;
const levelGlyph = (l: string) => (
  <span className={LEVEL_CLASSES[l as LevelId].text}>{LEVEL_GLYPH[l as LevelId]}</span>
);

interface Group {
  key: string;
  label: string;
  badge: React.ReactNode;
  rows: RepoTrajectory[];
}

function buildGroups(mode: Mode, rows: RepoTrajectory[]): Group[] {
  if (mode === "stack") {
    return rolesPresent(rows).map((role) => ({
      key: role,
      label: STACK_ROLE_LABEL[role],
      badge: <StackRoleIcon role={role} size={15} />,
      rows: rows.filter((r) => rolesOf(r).includes(role)),
    }));
  }
  if (mode === "level") {
    return levelsPresent(rows).map((l) => ({
      key: l,
      label: l,
      badge: levelGlyph(l),
      rows: rows.filter((r) => r.level === l),
    }));
  }
  return posturesPresent(rows).map((p) => ({
    key: p,
    label: postureLabel(p),
    badge: dot(p),
    rows: rows.filter((r) => r.posture === p),
  }));
}

function agg(rows: RepoTrajectory[]) {
  const avg = Math.round(rows.reduce((a, r) => a + r.overall, 0) / rows.length);
  // Net move excludes engine-transition (mock → live) deltas — those reflect a scoring-engine switch,
  // not real movement — so a cohort's "avg move" reads as genuine code-change momentum.
  return { avg, net: avgRealMove(rows) };
}

function RollupRow({ r, orgSlug }: { r: RepoTrajectory; orgSlug: string }) {
  const lc = LEVEL_CLASSES[r.level] ?? LEVEL_CLASSES.L1;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={reportPermalink(r.fullName, null, orgSlug)}
          title={`Open ${r.fullName}'s report`}
          className="focus-ring min-w-0 truncate font-mono text-sm text-slate-200 transition hover:text-accent"
        >
          <span className="text-slate-500">{r.owner}/</span>
          {r.name}
        </Link>
        {/* Provenance: a mock-engine score is the deterministic FLOOR, not a real graded scan — flag it. */}
        {isMockEngine(r.engine) && (
          <span
            title="Deterministic mock score — a placeholder floor, not a live graded scan. Re-scan live to replace it."
            className="shrink-0 rounded border border-slate-700 px-1 font-mono text-xs uppercase tracking-wider text-slate-500"
          >
            mock
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1 text-slate-500" aria-hidden>
          {rolesOf(r).slice(0, 3).map((role) => (
            <StackRoleIcon key={role} role={role} size={13} />
          ))}
        </span>
        <span className={`font-mono text-xs ${lc.text}`}>{r.level}</span>
        <span className="font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(r.overall) }}>
          {r.overall}
        </span>
        {r.deltaWindow == null ? (
          <span className="w-12 text-right font-mono text-xs text-slate-600">—</span>
        ) : r.deltaCrossesEngine ? (
          // Muted: this delta spans a mock → live engine change, so it reflects a scoring-engine
          // transition, not a real code-change movement. Don't dress it in the confident up/down tone.
          <span
            className="w-12 text-right font-mono text-xs tabular-nums text-slate-500"
            title="Spans a mock → live engine change — an engine transition, not a real code-change delta"
          >
            {fmtDelta(r.deltaWindow)}
          </span>
        ) : (
          <span className="w-12 text-right font-mono text-xs tabular-nums" style={{ color: deltaHex(r.deltaWindow) }}>
            {fmtDelta(r.deltaWindow)}
          </span>
        )}
        <span className="hidden w-16 text-right font-mono text-xs text-slate-500 sm:inline">{freshness(r.scannedAt)}</span>
      </div>
    </div>
  );
}

function GroupCard({ g, orgSlug }: { g: Group; orgSlug: string }) {
  const { avg, net } = agg(g.rows);
  const rows = [...g.rows].sort((a, b) => b.overall - a.overall);
  return (
    <div className="overflow-hidden rounded-2xl border border-divider bg-surface/40">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-divider px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-sm text-slate-100">
          {g.badge}
          {g.label}
          <span className="text-slate-500">· {g.rows.length}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold tabular-nums" style={{ color: scoreHex(avg) }}>
            {avg}
          </span>
          <Meter value={avg} size="sm" color={scoreHex(avg)} className="w-24" />
        </span>
        {net != null && (
          <span className="font-mono text-xs tabular-nums" style={{ color: deltaHex(net) }}>
            {fmtDelta(net)} avg move
          </span>
        )}
      </div>
      <div className="divide-y divide-divider">
        {rows.map((r) => (
          <RollupRow key={r.fullName} r={r} orgSlug={orgSlug} />
        ))}
      </div>
    </div>
  );
}

export function RepoCategoryRollup({
  trajectories,
  periodTitle,
  orgSlug,
}: {
  trajectories: RepoTrajectory[];
  periodTitle: string;
  orgSlug: string;
}) {
  const [mode, setMode] = useState<Mode>("type");
  const [filters, setFilters] = useState<RepoFilters>(emptyFilters);

  const toggle = (bucket: keyof RepoFilters, value: string) =>
    setFilters((f) => {
      const next: RepoFilters = { types: new Set(f.types), roles: new Set(f.roles), levels: new Set(f.levels) };
      const set = next[bucket] as Set<string>;
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return next;
    });
  const clear = (bucket: keyof RepoFilters) => setFilters((f) => ({ ...f, [bucket]: new Set() }));

  // Options come from the FULL set so the dropdowns don't shrink as you filter.
  const typeOpts: FilterOption[] = posturesPresent(trajectories).map((p) => ({ value: p, label: postureLabel(p), leading: dot(p) }));
  const stackOpts: FilterOption[] = rolesPresent(trajectories).map((role) => ({ value: role, label: STACK_ROLE_LABEL[role], leading: <StackRoleIcon role={role} size={14} /> }));
  const levelOpts: FilterOption[] = levelsPresent(trajectories).map((l) => ({ value: l, label: l, leading: levelGlyph(l) }));

  const filtered = applyFilters(trajectories, filters);
  const groups = buildGroups(mode, filtered).sort((a, b) => agg(b.rows).avg - agg(a.rows).avg);
  const active = filtersActive(filters);
  const fleet = summarize(filtered);

  return (
    <Surface className="p-5">
      <SectionHeader
        size="sm"
        title="Fleet"
        description={`Every repository grouped by ${mode} — where each cohort stands and how it's moving · ${periodTitle}`}
        right={
          <div className="flex items-center gap-1" role="group" aria-label="Group by">
            <span className="mr-1 font-mono text-xs uppercase tracking-widest text-slate-500">Group</span>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={`focus-ring rounded-full border px-2.5 py-1 font-mono text-xs transition ${
                  mode === m.id ? "border-accent/60 text-white" : "border-divider text-slate-400 hover:border-accent hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Fleet masthead — the "so what" of the shown set in one typeset line. Movement counts + avg move
          exclude single-scan and mock→live engine-transition deltas, so they read as real momentum.
          Skipped for a filtered-to-zero set: summarize()'s 0-default is a division guard, not a score,
          and rendering "avg 0" in scoreHex(0) alarm-red reads as a catastrophic fleet grade rather
          than "no rows matched" (the empty message below already says that). */}
      {filtered.length > 0 && (
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-sm">
        <span className="text-slate-500">
          <span className="tabular-nums text-slate-200">{fleet.repos}</span> repos
        </span>
        <span className="text-slate-500">
          avg <span className="font-bold tabular-nums" style={{ color: scoreHex(fleet.avgOverall) }}>{fleet.avgOverall}</span>
        </span>
        {/* Counts wear the canonical DIRECTION_TONE pair (the same source as the per-row deltas they
            summarize) — never hand-picked hexes, per repoTrajectory's module rule. */}
        <span className="tabular-nums" style={{ color: DIRECTION_TONE.rising.color }}>▲ {fleet.improving}</span>
        <span className="tabular-nums" style={{ color: DIRECTION_TONE.falling.color }}>▼ {fleet.slipping}</span>
        <span className="tabular-nums text-slate-500">→ {fleet.holding}</span>
        <span className="text-slate-500">
          avg move{" "}
          {fleet.avgMove == null ? (
            <span className="text-slate-600">—</span>
          ) : (
            <span className="font-bold tabular-nums" style={{ color: deltaHex(fleet.avgMove) }}>{fmtDelta(fleet.avgMove)}</span>
          )}
        </span>
        {fleet.mock > 0 && (
          <span className="text-slate-500" title="repositories still showing a deterministic mock score — re-scan live to replace">
            <span className="tabular-nums text-slate-400">{fleet.mock}</span> mock
          </span>
        )}
      </div>
      )}

      {/* Header filter dropdowns — replace the old top selector row. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FilterMenu label="Type" options={typeOpts} selected={filters.types} onToggle={(v) => toggle("types", v)} onClear={() => clear("types")} />
        <FilterMenu label="Stack" options={stackOpts} selected={filters.roles} onToggle={(v) => toggle("roles", v)} onClear={() => clear("roles")} />
        <FilterMenu label="Level" options={levelOpts} selected={filters.levels} onToggle={(v) => toggle("levels", v)} onClear={() => clear("levels")} />
        {active && (
          <button
            type="button"
            onClick={() => setFilters(emptyFilters())}
            className="focus-ring font-mono text-xs uppercase tracking-widest text-accent hover:text-white"
          >
            clear · {filtered.length} of {trajectories.length}
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-slate-500">No repositories match these filters.</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <GroupCard key={g.key} g={g} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </Surface>
  );
}
