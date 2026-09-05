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
// UNSCOPED — so `?stack=` narrowed the table above while the context lens below kept describing the
// whole fleet. Two panels on one screen must not describe different repo sets.

import { getOrgRollupShared } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { SectionEmpty } from "@/components/org/shared/ui";
import { buildContextRows } from "./contextHealthModel";
import { ContextHalfLife } from "./ContextHalfLife";
import { buildCoherenceRows } from "./guidanceCoherenceModel";
import { GuidanceCoherenceCard } from "./GuidanceCoherenceCard";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ContextHealthPanel({ slug, sp }: { slug: string; sp: SearchParams }) {
  const { techGroupId } = await resolveStackScope(slug, sp);
  const rollup = await getOrgRollupShared(slug, undefined, null, techGroupId);
  if (!rollup || rollup.repos.length === 0) {
    return <SectionEmpty>No repositories to read a context layer from yet.</SectionEmpty>;
  }
  const rows = buildContextRows(rollup.repos);
  return (
    <div className="space-y-8">
      <ContextHalfLife slug={slug} rows={rows} />
      {/* #15 — half-life answers "when did this stop being true?"; coherence answers "is it true in
          more than one place at once?". Same context layer, same fetch, two orthogonal questions. */}
      <GuidanceCoherenceCard rows={buildCoherenceRows(rollup.repos)} />
    </div>
  );
}
