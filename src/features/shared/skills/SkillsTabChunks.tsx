"use client";

// Token panel, code-split the Way. Members only, below the catalog.
import dynamic from "next/dynamic";

export const ApiTokensPanelChunk = dynamic(
  () => import("@/features/shared/skills/ApiTokensPanel").then((m) => m.ApiTokensPanel),
  { ssr: false },
);
