// Org dashboard "Skills" tab (Prism composition: SkillsTab.v2).
// Filename PINNED as SkillsTab.tsx. It takes `slug` because it is not a route.
import { SkillsTabV2 } from "./SkillsTab.v2";

export async function SkillsTab({ slug }: { slug: string }) {
  return <SkillsTabV2 slug={slug} />;
}
