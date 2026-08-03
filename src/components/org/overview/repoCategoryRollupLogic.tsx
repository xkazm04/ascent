// Pure grouping/aggregation logic for RepoCategoryRollup.tsx. Split out per
// docs/ORG-TABS-REFACTOR.md's extraction order (pure functions before JSX regions) to keep
// RepoCategoryRollup.tsx under the 200-LOC cap.

import { postureLabel } from "@/components/org/shared/ui";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { StackRoleIcon } from "@/components/org/overview/orgIcons";
import {
  posturesPresent,
  rolesPresent,
  levelsPresent,
  rolesOf,
  avgRealMove,
  avgRealScore,
  realScoredRepos,
  POSTURE_DOT,
  POSTURE_DOT_FALLBACK,
  STACK_ROLE_LABEL,
  type RepoTrajectory,
} from "@/components/org/overview/repoTrajectory";

export type Mode = "type" | "stack" | "level";

export const MODES: { id: Mode; label: string }[] = [
  { id: "type", label: "Type" },
  { id: "stack", label: "Stack" },
  { id: "level", label: "Level" },
];

export const dot = (p: string) => (
  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: POSTURE_DOT[p] ?? POSTURE_DOT_FALLBACK }} />
);
export const levelGlyph = (l: string) => (
  <span className={LEVEL_CLASSES[l as LevelId].text}>{LEVEL_GLYPH[l as LevelId]}</span>
);

export interface Group {
  key: string;
  label: string;
  badge: React.ReactNode;
  rows: RepoTrajectory[];
}

export function buildGroups(mode: Mode, rows: RepoTrajectory[]): Group[] {
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

/**
 * A group's two aggregates, both computed over the honest population rather than every row:
 *  - `avg` excludes deterministic-mock placeholders (avgRealScore) — a mock score is a floor the
 *    scanner emits without ever calling a model, so averaging it in reports a measurement over a set
 *    that was partly never measured. Null when the group has no live-scored repo at all.
 *  - `net` excludes engine-transition (mock → live) deltas — those reflect a scoring-engine switch,
 *    not real movement — so a cohort's "avg move" reads as genuine code-change momentum.
 *
 * `realScored` is `avg`'s denominator, so the renderer can disclose what the number was measured
 * over instead of leaving the mock count as a chip beside a contaminated figure.
 */
export function agg(rows: RepoTrajectory[]) {
  return { avg: avgRealScore(rows), realScored: realScoredRepos(rows).length, net: avgRealMove(rows) };
}
