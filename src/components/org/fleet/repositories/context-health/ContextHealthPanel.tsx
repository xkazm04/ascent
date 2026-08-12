// Context Health — the Repositories tab's context-layer lens (PROTOTYPE, P4).
//
// "Your codebase is the prompt": ascent (like every competitor) currently scores the PRESENCE of
// AGENTS.md / CLAUDE.md and stops there. This panel measures the QUALITY of that layer — freshness
// against the repo's change rate, authorship provenance, specificity, and coverage — which is the
// named white space in the 2026 agentic-SDLC research.
//
// SERVER component: it owns the data fetch (getOrgRollup) and hands plain props to the CLIENT
// switcher. Quality metrics have no data model yet, so the rows come from the clearly-marked
// contextHealthMock module, which reads REAL presence/churn/D5 off OrgRepoRow and synthesizes only
// the fields no scan persists.

import { getOrgRollup } from "@/lib/db";
import { SectionEmpty } from "@/components/org/shared/ui";
import { buildContextHealth } from "./contextHealthMock";
import { ContextHealthSwitcher } from "./ContextHealthSwitcher";

export async function ContextHealthPanel({ slug }: { slug: string }) {
  const rollup = await getOrgRollup(slug);
  if (!rollup || rollup.repos.length === 0) {
    return <SectionEmpty>No repositories to read a context layer from yet.</SectionEmpty>;
  }
  const rows = buildContextHealth(rollup.repos);
  return <ContextHealthSwitcher slug={slug} rows={rows} />;
}
