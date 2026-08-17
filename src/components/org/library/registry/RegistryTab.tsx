// Org dashboard "Registry" tab — the onboarding + tracking surface for the customer-owned registry
// repo that becomes the source of truth for Skills, Practices and Memory
// (docs/REGISTRY-AND-CARE-IMPL.md §4). First item in the `Chosen` group: the other three tabs in that
// group depend on this one being set up.
//
// SERVER component, filename PINNED as RegistryTab.tsx, `slug` + `sp` props — same shell contract as
// SkillsTab / MemoryTab (docs/ORG-TABS-REFACTOR.md). One data source (`getRegistryView`), so the
// single <Suspense> at the OrgTabChunks call site is enough and no boundary is added here.
//
// PROTOTYPE ROUND: `?demo=<state>` selects a fixture view so all three directions can be judged
// against the indexed dashboard and every edge case, not just the honest-but-empty unmapped state.
// The real loader returns `unmapped` until the OrgRegistry table + indexer land (R2).

import { RegistryPanelSwitcher } from "./RegistryPanelSwitcher";
import { getRegistryView } from "@/lib/org/registry-view";

type SearchParams = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function RegistryTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const view = await getRegistryView(slug, { demo: one(sp.demo) });
  return <RegistryPanelSwitcher view={view} slug={slug} />;
}
