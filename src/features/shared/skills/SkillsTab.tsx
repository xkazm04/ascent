// Org dashboard "Skills" tab. Altimeter markup lives in SkillsTab.v1; Prism is SkillsTab.v2.
// Filename PINNED as SkillsTab.tsx. It takes `slug` because it is not a route.
import { getTheme } from "@/lib/theme/server";
import { SkillsTabV1 } from "./SkillsTab.v1";
import { SkillsTabV2 } from "./SkillsTab.v2";

export async function SkillsTab({ slug }: { slug: string }) {
  const theme = await getTheme();
  return theme === "prism" ? <SkillsTabV2 slug={slug} /> : <SkillsTabV1 slug={slug} />;
}
