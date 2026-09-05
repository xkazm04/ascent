// The Segments view, rendered as the "Segments" mode of the Repositories tab (docs/ORG-TABS-REFACTOR.md).
// Server component: it owns its own reads (the segment manager's inputs, segment summaries, and the
// A/B comparison) so the host tab stays a thin orchestrator. The FleetTabs bar and the outer spacing
// are supplied by the host, not here.
//
// The segment MANAGER leads this view. It used to live on the Repositories tab, which left this one
// with an empty state whose only advice was "go to the Repositories tab and create one" — a dead end
// on the exact screen a user opens to work on segments. The manager is now here and renders at ANY
// segment count, so "Segments" is where you both create a segment and read what it tells you; the
// rollup strip and the A/B comparison simply appear beneath it once there is something to roll up.
//
// SegmentCard and the A/B comparison JSX are extracted siblings (SegmentCard.tsx,
// SegmentsComparePanel.tsx) so this file stays under the 200-LOC cap (AGENTS.md).

import { SegmentCard } from "./SegmentCard";
import { SegmentsComparePanel } from "./SegmentsComparePanel";
import { RepoSegmentsPanel } from "./RepoSegmentsPanel";
import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import {
  compareSegments,
  getRepoSegmentMap,
  listSegmentSummaries,
  listSegments,
  listTaggableRepos,
  listWatchedRepos,
} from "@/lib/db";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function SegmentsSection({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const sp = searchParams;

  const [summaries, segMap, watchedRepos, segments, taggableRepos] = await Promise.all([
    listSegmentSummaries(slug).then((s) => s ?? []),
    getRepoSegmentMap(slug),
    listWatchedRepos(slug),
    listSegments(slug).then((s) => s ?? []),
    listTaggableRepos(slug),
  ]);
  // Invert the repo→segments map into segment id → tagged repo fullNames, so each card can scan or
  // schedule exactly its slice.
  const reposBySegment: Record<string, string[]> = {};
  for (const [fullName, segs] of Object.entries(segMap)) {
    for (const seg of segs) (reposBySegment[seg.id] ??= []).push(fullName);
  }
  // The manager's per-repo tagging state, over the same repo universe it can offer (fullName → the
  // segment ids it currently carries).
  const membership: Record<string, string[]> = {};
  for (const r of taggableRepos) membership[r.fullName] = (segMap[r.fullName] ?? []).map((s) => s.id);
  // repositories-segments #2: POST /api/org/scan intersects the request with the WATCH list, so hand
  // each card only the watched slice (what the scan will actually do) plus the tagged total — the old
  // "Scan segment (7)" over 3 watched repos promised 7, showed "0/7…", then snapped to 3 mid-flight.
  const watched = new Set(watchedRepos.map((r) => r.fullName));

  // The create/tag mechanism — rendered FIRST and unconditionally, so an org with no segments still
  // has the control that makes one right where it looked for it.
  const manager = (
    <RepoSegmentsPanel slug={slug} repos={taggableRepos} segments={segments} membership={membership} />
  );

  if (summaries.length === 0) {
    return (
      <>
        {manager}
        <SectionEmpty>
          No segments to roll up yet. Create one above and tag a few repos into it — named slices of the
          fleet (platform, mobile, legacy…) — then their maturity lands here and you can compare two of
          them side by side.
        </SectionEmpty>
      </>
    );
  }

  const options = summaries.filter((s) => s.id).map((s) => ({ id: s.id as string, name: s.name }));
  const ids = new Set(options.map((o) => o.id));

  // Resolve the A/B selection from the URL, defaulting to the first two segments (B = whole fleet
  // when there's only one segment to compare against the org baseline).
  const aParam = first(sp.a);
  const bParam = first(sp.b);
  const aId = aParam && ids.has(aParam) ? aParam : options[0]!.id; // safe: summaries non-empty above, each maps to an option
  const bId = bParam && ids.has(bParam) && bParam !== aId ? bParam : options.find((o) => o.id !== aId)?.id ?? null;

  const comparison = await compareSegments(slug, aId, bId);

  return (
    <>
      {manager}

      {/* Per-segment rollup strip */}
      <div>
        <SectionHeader
          title="Segment maturity"
          description="Per-segment maturity across the fleet, each slice rolled up from its tagged repos' latest scans."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => {
            const tagged = s.id ? reposBySegment[s.id] ?? [] : [];
            return (
              <SegmentCard
                key={s.id ?? "fleet"}
                s={s}
                org={slug}
                repos={tagged.filter((fn) => watched.has(fn))}
                taggedCount={tagged.length}
              />
            );
          })}
        </div>
      </div>

      {/* Side-by-side comparison */}
      <SegmentsComparePanel options={options} aId={aId} bId={bId} comparison={comparison} />
    </>
  );
}
