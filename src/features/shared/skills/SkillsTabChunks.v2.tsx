"use client";

// Prism token panel, code-split the same way as the Altimeter chunk. Members only, below the catalog.
import dynamic from "next/dynamic";

export const ApiTokensPanelV2Chunk = dynamic(
  () => import("@/features/shared/skills/ApiTokensPanel.v2").then((m) => m.ApiTokensPanelV2),
  { ssr: false },
);
