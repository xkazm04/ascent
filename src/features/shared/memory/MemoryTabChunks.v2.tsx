"use client";

import dynamic from "next/dynamic";

export const MemoryRecallV2Chunk = dynamic(
  () => import("@/features/shared/memory/MemoryRecall.v2").then((m) => m.MemoryRecallV2),
  { ssr: false },
);

export const MemoryReflectV2Chunk = dynamic(
  () => import("@/features/shared/memory/MemoryReflect.v2").then((m) => m.MemoryReflectV2),
  { ssr: false },
);
