// Context Health — the Repositories tab's context-layer lens (REAL as of W4).
//
// "Your codebase is the prompt": presence-checkers score whether AGENTS.md / CLAUDE.md EXISTS and
// stop there. This panel measures the QUALITY of that layer — freshness against the repo's own
// change rate, guidance quality, and dead-reference drift — from the contextHealthJson each scan
// now persists (src/lib/analyze/context-health.ts). The P4 prototype's Baseline/Half-life switcher
// and its mock synthesis are retired: Half-life renders directly, on real data only.
//
// SERVER component: it owns the data fetch (getOrgRollup) and hands plain props to the client-free
// Half-life renderer.

import { getOrgRollup } from "@/lib/db";
import { SectionEmpty } from "@/components/org/shared/ui";
import { buildContextRows } from "./contextHealthModel";
import { ContextHalfLife } from "./ContextHalfLife";

export async function ContextHealthPanel({ slug }: { slug: string }) {
  const rollup = await getOrgRollup(slug);
  if (!rollup || rollup.repos.length === 0) {
    return <SectionEmpty>No repositories to read a context layer from yet.</SectionEmpty>;
  }
  const rows = buildContextRows(rollup.repos);
  return <ContextHalfLife slug={slug} rows={rows} />;
}
