// The Overview repos×time view's DISPLAY MAPS (posture dots, stack-role labels) and its enum-filter
// model — the header dropdowns' options + predicates. Extracted from repoTrajectory.ts, which
// re-exports every name here so call sites keep importing from that one module. Pure, no React, and
// colors/tones come from the canonical enums, never hand-picked at call sites.

import type { LevelId, StackRole } from "@/lib/types";

import type { RepoTrajectory } from "./repoTrajectory";

// ── Display maps: type (posture) dots + stack (role) labels ────────────────────

/** The POSTURE_DOT fallback for an unknown/legacy posture id — one exported constant so renderers
 *  don't re-inline the slate hex ad hoc (the module rule: colors never hand-picked at call sites). */
export const POSTURE_DOT_FALLBACK = "#64748b";

/** Colored dot per posture "type" — reuses the war-room posture palette. Unknown → slate. */
export const POSTURE_DOT: Record<string, string> = {
  "ai-native": "#22c55e",
  ungoverned: "#f97316",
  manual: "#38bdf8",
  early: "#64748b",
};

export const STACK_ROLE_LABEL: Record<StackRole, string> = {
  frontend: "Frontend",
  backend: "Backend",
  mobile: "Mobile",
  data_ml: "Data / ML",
  infra: "Infra",
  library: "Library",
  unknown: "Unknown",
};

const POSTURE_RANK: Record<string, number> = { "ai-native": 0, ungoverned: 1, manual: 2, early: 3 };

/** A repo's displayable roles (unknown dropped, order preserved). */
export function rolesOf(t: RepoTrajectory): StackRole[] {
  return (t.techStack?.roles ?? []).filter((r) => r !== "unknown");
}

// ── Enum filters (header dropdowns) ─────────────────────────────────────────────

export interface RepoFilters {
  types: Set<string>; // postures — empty = all
  roles: Set<StackRole>; // any-match — empty = all
  levels: Set<string>; // levels — empty = all
}

export function emptyFilters(): RepoFilters {
  return { types: new Set(), roles: new Set(), levels: new Set() };
}

export function filtersActive(f: RepoFilters): boolean {
  return f.types.size > 0 || f.roles.size > 0 || f.levels.size > 0;
}

export function applyFilters(rows: RepoTrajectory[], f: RepoFilters): RepoTrajectory[] {
  return rows.filter((r) => {
    if (f.types.size && !f.types.has(r.posture)) return false;
    if (f.levels.size && !f.levels.has(r.level)) return false;
    if (f.roles.size && !rolesOf(r).some((x) => f.roles.has(x))) return false;
    return true;
  });
}

/** The postures actually present, in canonical order — the Type dropdown's options. */
export function posturesPresent(rows: RepoTrajectory[]): string[] {
  const set = new Set(rows.map((r) => r.posture).filter(Boolean));
  return [...set].sort((a, b) => (POSTURE_RANK[a] ?? 99) - (POSTURE_RANK[b] ?? 99));
}

/** The stack roles actually present, in canonical order — the Stack dropdown's options. */
export function rolesPresent(rows: RepoTrajectory[]): StackRole[] {
  const set = new Set<StackRole>();
  for (const r of rows) for (const role of rolesOf(r)) set.add(role);
  const order: StackRole[] = ["frontend", "backend", "mobile", "data_ml", "infra", "library"];
  return order.filter((o) => set.has(o));
}

/** The levels actually present, L1→L5 — the Level dropdown's options. */
export function levelsPresent(rows: RepoTrajectory[]): string[] {
  const set = new Set(rows.map((r) => r.level));
  return ["L1", "L2", "L3", "L4", "L5"].filter((l) => set.has(l as LevelId));
}
