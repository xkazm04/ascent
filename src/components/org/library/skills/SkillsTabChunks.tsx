"use client";

// dynamic() registry for the Skills tab (docs/ORG-TABS-REFACTOR.md §3, "5. dynamic() registry"). Only
// ApiTokensPanel lives here: it's a below-the-fold, member-only client panel (mint/list/revoke tokens)
// that most viewers never touch, so it code-splits out of the main SkillsPanel bundle and mounts a beat
// later via <Defer> in SkillsTab.tsx rather than blocking the catalog's first paint.

import dynamic from "next/dynamic";

export const ApiTokensPanelChunk = dynamic(
  () => import("@/components/org/library/skills/ApiTokensPanel").then((m) => m.ApiTokensPanel),
  { ssr: false },
);
