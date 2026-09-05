// Org dashboard "Registry" tab — the onboarding + tracking surface for the customer-owned registry
// repo that becomes the source of truth for Skills, Practices and Memory
// (docs/REGISTRY-AND-CARE-IMPL.md §4). First item in the `Shared` group: the other three tabs in that
// group depend on this one being set up.
//
// SERVER component, filename PINNED as RegistryTab.tsx — same shell contract as SkillsTab / MemoryTab
// (docs/ORG-TABS-REFACTOR.md). One data source (`getRegistryView`), so the single <Suspense> at the
// OrgTabChunks call site is enough and no boundary is added here.
//
// It takes NO `sp`: the tab reads nothing from the URL. Selecting a shaped example state used to be
// `?demo=`, which made a preview shareable and bookmarkable; it is React state inside
// `RegistryPreviewShell` now. The real panel below stays server-rendered — it is passed as
// `children`, so the preview branch is the only client cost.
//
// The switcher is a DEVELOPMENT affordance and is gated as one (`registryPreviewEnabled()`, opt-in via
// `ASCENT_REGISTRY_PREVIEW` and hard-off in production): on a real deployment the first thing an
// operator meets on an empty tab should be their own registry's invitation, not someone else's shaped
// example. The `unmapped` condition stays on top of it — a mapped registry is never painted over.

import { RegistryPanel } from "./RegistryPanel";
import { RegistryPreviewShell } from "./RegistryPreviewShell";
import { registryPreviewEnabled } from "@/lib/env";
import { getRegistryView } from "@/lib/org/registry-view";

export async function RegistryTab({ slug }: { slug: string }) {
  const view = await getRegistryView(slug);
  return (
    <RegistryPreviewShell slug={slug} enabled={registryPreviewEnabled() && view.status === "unmapped"}>
      <RegistryPanel view={view} slug={slug} />
    </RegistryPreviewShell>
  );
}
