// Prism Context Health. Same scoped rollup as ContextHealthPanel; the render is a kit frame.
import { Frame, Lede } from "@/components/kit";
import { getOrgRollupShared } from "@/lib/db";
import type { OrgScope } from "@/lib/org/scope";
import { buildContextRows } from "./contextHealthModel";
import { ContextHalfLifeV2 } from "./ContextHalfLife.v2";

export async function ContextHealthPanelV2({ slug, scope }: { slug: string; scope: Promise<OrgScope> }) {
  const { segmentId, techGroupId } = await scope;
  const rollup = await getOrgRollupShared(slug, undefined, segmentId, techGroupId);
  if (!rollup || rollup.repos.length === 0) {
    return (
      <Frame edge="top" aria-label="Context half-life">
        <Lede>No repositories to read a context layer from yet.</Lede>
      </Frame>
    );
  }
  return <ContextHalfLifeV2 slug={slug} rows={buildContextRows(rollup.repos)} />;
}
