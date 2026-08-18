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
// `RegistryPreviewShell` now, offered only while the real registry is unmapped. The real panel below
// stays server-rendered — it is passed as `children`, so the preview branch is the only client cost.

import { RegistryPanel } from "./RegistryPanel";
import { RegistryPreviewShell } from "./RegistryPreviewShell";
import { getRegistryView } from "@/lib/org/registry-view";

export async function RegistryTab({ slug }: { slug: string }) {
  const view = await getRegistryView(slug);
  return (
    <RegistryPreviewShell slug={slug} enabled={view.status === "unmapped"}>
      <RegistryPanel view={view} slug={slug} />
    </RegistryPreviewShell>
  );
}
