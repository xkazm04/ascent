// The Segments view, rendered as the "Segments" mode of the Repositories tab (docs/ORG-TABS-REFACTOR.md).
// Server component: it owns its own reads (segment summaries + A/B comparison) so the host tab stays a
// thin orchestrator. The FleetTabs bar and the outer spacing are supplied by the host, not here.
//
// SegmentCard and the A/B comparison JSX are extracted siblings (SegmentCard.tsx,
// SegmentsComparePanel.tsx) so this file stays under the 200-LOC cap (AGENTS.md).

import Link from "next/link";
import { SegmentCard } from "./SegmentCard";
import { SegmentsComparePanel } from "./SegmentsComparePanel";
import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { compareSegments, getRepoSegmentMap, listSegmentSummaries, listWatchedRepos } from "@/lib/db";
import { orgTabHref } from "@/lib/org/orgTabs";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function SegmentsSection({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const sp = searchParams;

  const [summaries, segMap, watchedRepos] = await Promise.all([
    listSegmentSummaries(slug).then((s) => s ?? []),
    getRepoSegmentMap(slug),
    listWatchedRepos(slug),
  ]);
  // Invert the repo→segments map into segment id → tagged repo fullNames, so each card can scan or
  // schedule exactly its slice.
  const reposBySegment: Record<string, string[]> = {};
  for (const [fullName, segs] of Object.entries(segMap)) {
    for (const seg of segs) (reposBySegment[seg.id] ??= []).push(fullName);
  }
  // repositories-segments #2: POST /api/org/scan intersects the request with the WATCH list, so hand
  // each card only the watched slice (what the scan will actually do) plus the tagged total — the old
  // "Scan segment (7)" over 3 watched repos promised 7, showed "0/7…", then snapped to 3 mid-flight.
  const watched = new Set(watchedRepos.map((r) => r.fullName));
  if (summaries.length === 0) {
    return (
      <SectionEmpty>
        No segments yet. Create named slices of the fleet (platform, mobile, legacy…) and tag repos into them on the{" "}
        <Link href={orgTabHref(slug, "repositories")} className="text-accent hover:text-white">
          Repositories
        </Link>{" "}
        tab above, then compare them side by side here.
      </SectionEmpty>
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
      {/* Per-segment rollup strip */}
      <div>
        <SectionHeader
          title="Segments"
          description="Per-segment maturity across the fleet — each slice rolled up from its tagged repos' latest scans."
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
