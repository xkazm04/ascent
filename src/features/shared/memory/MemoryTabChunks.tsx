"use client";

// dynamic() registry for the Memory tab (docs/ORG-TABS-REFACTOR.md §3, "5. dynamic() registry"). Recall
// and Reflect are both below-the-fold, purely-client-interactive panels (they run on demand — no server
// data is awaited to render them) — good candidates to code-split out of the main bundle and mount a
// beat later via <Defer> in MemoryTab.tsx rather than shipping with the browsable list on first paint.

import dynamic from "next/dynamic";

export const MemoryRecallPanelChunk = dynamic(
  () => import("@/features/shared/memory/MemoryRecallPanel").then((m) => m.MemoryRecallPanel),
  { ssr: false },
);

export const MemoryReflectPanelChunk = dynamic(
  () => import("@/features/shared/memory/MemoryReflectPanel").then((m) => m.MemoryReflectPanel),
  { ssr: false },
);
