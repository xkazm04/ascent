// Org dashboard "Registry" tab. Filename PINNED as RegistryTab.tsx. It takes no `sp`:
// the tab reads nothing from the URL. The panel is the kit composition. The preview switcher stays a development affordance, hard-off in
// production, and only while the real status is unmapped.

import { registryPreviewEnabled } from "@/lib/env";
import { getRegistryView } from "@/lib/org/registry-view";
import { RegistryPanelV2 } from "./RegistryPanel.v2";
import { RegistryPreviewShell } from "./RegistryPreviewShell";

export async function RegistryTab({ slug }: { slug: string }) {
  const view = await getRegistryView(slug);
  const panel = <RegistryPanelV2 view={view} slug={slug} />;
  return (
    <RegistryPreviewShell slug={slug} enabled={registryPreviewEnabled() && view.status === "unmapped"}>
      {panel}
    </RegistryPreviewShell>
  );
}
