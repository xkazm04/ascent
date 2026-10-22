"use client";

import dynamic from "next/dynamic";

export const MemoryRecallChunk = dynamic(
  () => import("@/features/shared/memory/MemoryRecallView").then((m) => m.MemoryRecall),
  { ssr: false },
);

export const MemoryReflectChunk = dynamic(
  () => import("@/features/shared/memory/MemoryReflectView").then((m) => m.MemoryReflect),
  { ssr: false },
);
