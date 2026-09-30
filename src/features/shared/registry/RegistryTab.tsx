// Org dashboard "Registry" tab. Filename PINNED as RegistryTab.tsx. It takes no `sp`:
// the tab reads nothing from the URL. Altimeter renders the previous panel; Prism renders
// the kit composition. The preview switcher stays a development affordance, hard-off in
// production, and only while the real status is unmapped.

import { getTheme } from "@/lib/theme/server";
import { registryPreviewEnabled } from "@/lib/env";
import { getRegistryView } from "@/lib/org/registry-view";
import { RegistryPanel as RegistryPanelV1 } from "./RegistryPanel.v1";
import { RegistryPanelV2 } from "./RegistryPanel.v2";
import { RegistryPreviewShell } from "./RegistryPreviewShell";

export async function RegistryTab({ slug }: { slug: string }) {
  const [view, theme] = await Promise.all([getRegistryView(slug), getTheme()]);
  const panel =
    theme === "prism" ? <RegistryPanelV2 view={view} slug={slug} /> : <RegistryPanelV1 view={view} slug={slug} />;
  return (
    <RegistryPreviewShell slug={slug} theme={theme} enabled={registryPreviewEnabled() && view.status === "unmapped"}>
      {panel}
    </RegistryPreviewShell>
  );
}
