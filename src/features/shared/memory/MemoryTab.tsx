// Org dashboard "Memory" tab. The reads and the Altimeter markup live in MemoryTab.v1; Prism is
// MemoryTab.v2. Both start the same shared promises (viewer, namespaces, plan, registry sync).
// Filename PINNED as MemoryTab.tsx. It takes `slug` because it is not a route.
import { getTheme } from "@/lib/theme/server";
import { MemoryTabV1 } from "./MemoryTab.v1";
import { MemoryTabV2 } from "./MemoryTab.v2";

export async function MemoryTab({ slug }: { slug: string }) {
  const theme = await getTheme();
  return theme === "prism" ? <MemoryTabV2 slug={slug} /> : <MemoryTabV1 slug={slug} />;
}
