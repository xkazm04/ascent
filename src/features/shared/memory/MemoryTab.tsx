// Org dashboard "Memory" tab (Prism composition: MemoryTab.v2).
// Filename PINNED as MemoryTab.tsx. It takes `slug` because it is not a route.
import { MemoryTabV2 } from "./MemoryTab.v2";

export async function MemoryTab({ slug }: { slug: string }) {
  return <MemoryTabV2 slug={slug} />;
}
