// Prism Segments view. Same reads as SegmentsSection; the markup is the kit composition.
import { Frame, Lede } from "@/components/kit";
import { compareSegments, getRepoSegmentMap, listSegmentSummaries, listSegments, listTaggableRepos, listWatchedRepos } from "@/lib/db";
import { RepoSegmentsPanelV2 } from "./RepoSegmentsPanel.v2";
import { SegmentMaturityV2 } from "./SegmentMaturity.v2";
import { SegmentsCompareV2 } from "./SegmentsCompare.v2";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const EMPTY =
  "No segments to roll up yet. Create one above and tag a few repos into it, named slices of the fleet (platform, mobile, legacy), then their maturity lands here and you can compare two of them side by side. Tags also scope the Overview's segment filter, so every reading on that tab can be narrowed to one slice.";

export async function SegmentsSectionV2({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const [summaries, segMap, watchedRepos, segments, taggableRepos] = await Promise.all([
    listSegmentSummaries(slug).then((s) => s ?? []),
    getRepoSegmentMap(slug),
    listWatchedRepos(slug),
    listSegments(slug).then((s) => s ?? []),
    listTaggableRepos(slug),
  ]);
  const reposBySegment: Record<string, string[]> = {};
  for (const [fullName, segs] of Object.entries(segMap)) {
    for (const seg of segs) (reposBySegment[seg.id] ??= []).push(fullName);
  }
  const membership: Record<string, string[]> = {};
  for (const r of taggableRepos) membership[r.fullName] = (segMap[r.fullName] ?? []).map((s) => s.id);
  const watched = new Set(watchedRepos.map((r) => r.fullName));
  const manager = <RepoSegmentsPanelV2 slug={slug} repos={taggableRepos} segments={segments} membership={membership} />;

  if (summaries.length === 0) {
    return (
      <div className="space-y-8">
        {manager}
        <Frame edge="top" aria-label="Segment maturity">
          <Lede>{EMPTY}</Lede>
        </Frame>
      </div>
    );
  }

  const options = summaries.filter((s) => s.id).map((s) => ({ id: s.id as string, name: s.name }));
  const ids = new Set(options.map((o) => o.id));
  const aParam = first(searchParams.a);
  const bParam = first(searchParams.b);
  const aId = aParam && ids.has(aParam) ? aParam : options[0]!.id;
  const bId = bParam && ids.has(bParam) && bParam !== aId ? bParam : options.find((o) => o.id !== aId)?.id ?? null;
  const comparison = await compareSegments(slug, aId, bId);

  return (
    <div className="space-y-8">
      {manager}
      <SegmentMaturityV2 slug={slug} summaries={summaries} reposBySegment={reposBySegment} watched={watched} />
      <SegmentsCompareV2
        options={options}
        aId={aId}
        bId={bId}
        comparison={comparison}
        taggedById={Object.fromEntries(segments.map((s) => [s.id, s.repoCount]))}
      />
    </div>
  );
}
