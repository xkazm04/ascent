"use client";

// The fleet rollup's state and derivations — grouping mode, the Type/Stack/Level filters, the option
// lists, the ordered groups and the shown set's summary — shared by the Altimeter card and the v2 ruled
// rollup so the two cannot rank or filter differently. No markup here beyond the option glyphs.
import { useState } from "react";
import { postureLabel } from "@/components/org/shared/ui";
import type { FilterOption } from "./FilterMenu";
import { StackRoleIcon } from "./orgIcons";
import {
  applyFilters,
  emptyFilters,
  filtersActive,
  levelsPresent,
  posturesPresent,
  rolesPresent,
  summarize,
  STACK_ROLE_LABEL,
  type RepoFilters,
  type RepoTrajectory,
} from "./repoTrajectory";
import { agg, buildGroups, dot, levelGlyph, type Mode } from "./repoCategoryRollupLogic";

export function useFleetRollup(trajectories: RepoTrajectory[]) {
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
  // Type and Stack: strongest cohort first; a group with no live-scored repo has NO average (see agg) and
  // sorts to the end rather than being coerced to 0. Level: the ladder order L1→L5, always (a level is an
  // ordinal, and the group key is the level id, so a plain string compare is the ladder).
  const groups =
    mode === "level"
      ? buildGroups(mode, filtered).sort((a, b) => a.key.localeCompare(b.key))
      : buildGroups(mode, filtered).sort((a, b) => (agg(b.rows).avg ?? -1) - (agg(a.rows).avg ?? -1));

  return {
    mode,
    setMode,
    filters,
    setFilters,
    toggle,
    clear,
    typeOpts,
    stackOpts,
    levelOpts,
    filtered,
    groups,
    active: filtersActive(filters),
    reset: () => setFilters(emptyFilters()),
    fleet: summarize(filtered),
  };
}
