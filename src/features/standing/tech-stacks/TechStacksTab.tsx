// Org dashboard "Tech Stacks" tab — the stack × dimension heat matrix and the dimension analysis
// board. Migrated from src/app/org/[slug]/tech-stacks/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as TechStacksTab.tsx. No auth work here — the org layout's
// canReadOrg gate already ran.
//
// The A-vs-B "Compare stacks" panel that used to sit under the analysis was DELETED (2026-08-19),
// root and branch: TechStacksComparePanel / StackComparePanel / TechStackComparePicker, the
// `insightCompareHref` deep link into it, and its data read (`compareTechStacks` + `summarizeTechStack`
// in src/lib/db/tech-groups.ts, with their unit test). Everything it answered — which stack leads,
// which lags, by how much, on which dimension — the analysis board above it already answers for ALL
// stacks at once, per dimension, with a transformation playbook attached. Picking two stacks by hand
// was a strictly narrower read of the same numbers.

import { listTechStackGroups } from "@/lib/db";
import { techStacksView } from "./TechStacksTabView";

export async function TechStacksTab({ slug }: { slug: string }) {
  const groups = await listTechStackGroups(slug);
  return techStacksView(slug, groups.length);
}
