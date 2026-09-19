// Context Health — the Repositories tab's context-layer lens (REAL as of W4).
//
// "Your codebase is the prompt": presence-checkers score whether AGENTS.md / CLAUDE.md EXISTS and
// stop there. This panel measures the QUALITY of that layer — freshness against the repo's own
// change rate, guidance quality, and dead-reference drift — from the contextHealthJson each scan
// now persists (src/lib/analyze/context-health.ts). The P4 prototype's Baseline/Half-life switcher
// and its mock synthesis are retired: Half-life renders directly, on real data only.
//
// SERVER component: it owns the data fetch and hands plain props to the client-free Half-life
// renderer. It reads the rollup through `getOrgRollupShared` at the SAME scope its sibling
// leaderboard uses, for two reasons: the tab ran two full rollups per render, and this panel's was
// UNSCOPED — so `?stack=` / `?segment=` narrowed the table above while the context lens below kept
// describing the whole fleet. Two panels on one screen must not describe different repo sets.
// Scope is the SHARED promise RepositoriesTab created once; awaiting it here does not re-run it.

import { getOrgRollupShared } from "@/lib/db";
import type { OrgScope } from "@/lib/org/scope";
import { SectionEmpty } from "@/components/org/shared/ui";
import { buildContextRows } from "./contextHealthModel";
import { ContextHalfLife } from "./ContextHalfLife";

export async function ContextHealthPanel({ slug, scope }: { slug: string; scope: Promise<OrgScope> }) {
  const { segmentId, techGroupId } = await scope;
  const rollup = await getOrgRollupShared(slug, undefined, segmentId, techGroupId);
  if (!rollup || rollup.repos.length === 0) {
    return <SectionEmpty>No repositories to read a context layer from yet.</SectionEmpty>;
  }
  const rows = buildContextRows(rollup.repos);
  // Guidance coherence (#15) moved to Shared → Practices (2026-09-15), beside the foundation rollout:
  // the shared checklist and its measurement are read in one place.
  return <ContextHalfLife slug={slug} rows={rows} />;
}
