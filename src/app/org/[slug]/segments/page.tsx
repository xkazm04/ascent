import Link from "next/link";
import { SegmentComparePicker } from "@/components/org/SegmentComparePicker";
import { SegmentActions } from "@/components/org/SegmentActions";
import { SectionEmpty, SectionHeader, POSTURE_LABEL } from "@/components/org/ui";
import { SegmentComparisonView, first } from "@/components/org/SegmentComparisonView";
import { compareSegments, getRepoSegmentMap, listSegmentSummaries } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import type { SegmentSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

// Human posture label with a raw-id fallback. Deliberately the lookup-then-`?? raw` form (NOT the
// shared postureLabel(), which title-cases an unknown id) so the existing rendering is preserved
// exactly — the data layer only ever yields known posture ids, so the branches agree in practice.
const postureText = (posture: string) => POSTURE_LABEL[posture] ?? posture;

/** One segment's headline standing — the per-segment rollup card in the overview strip. Real
 *  segments (with an id) also get scan + cadence controls scoped to their tagged repos. */
function SegmentCard({ s, org, repos }: { s: SegmentSummary; org: string; repos: string[] }) {
  const level = levelForScore(s.avgOverall);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-white">{s.name}</span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">{postureText(s.posture)}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: scoreHex(s.avgOverall) }}>
          {s.avgOverall}
        </span>
        <span className="font-mono text-sm text-slate-500">{level.id} · {level.name}</span>
      </div>
      <div className="mt-2 flex gap-4 font-mono text-sm text-slate-400">
        <span>adopt {s.avgAdoption}</span>
        <span>rigor {s.avgRigor}</span>
      </div>
      <div className="mt-1 font-mono text-sm text-slate-600">{s.scannedCount}/{s.repoCount} scanned</div>
      {s.id && <SegmentActions org={org} segmentId={s.id} repos={repos} />}
    </div>
  );
}

export default async function OrgSegments({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const [summaries, segMap] = await Promise.all([
    listSegmentSummaries(slug).then((s) => s ?? []),
    getRepoSegmentMap(slug),
  ]);
  // Invert the repo→segments map into segment id → tagged repo fullNames, so each card can scan or
  // schedule exactly its slice.
  const reposBySegment: Record<string, string[]> = {};
  for (const [fullName, segs] of Object.entries(segMap)) {
    for (const seg of segs) (reposBySegment[seg.id] ??= []).push(fullName);
  }
  if (summaries.length === 0) {
    return (
      <SectionEmpty>
        No segments yet. Create named slices of the fleet (platform, mobile, legacy…) and tag repos into them on the{" "}
        <Link href={`/org/${slug}/repositories`} className="text-accent hover:text-white">
          Repositories
        </Link>{" "}
        tab, then compare them side by side here.
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
    <div className="space-y-6">
      {/* Per-segment rollup strip */}
      <div>
        <SectionHeader
          title="Segments"
          description="Per-segment maturity across the fleet — each slice rolled up from its tagged repos' latest scans."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => (
            <SegmentCard key={s.id ?? "fleet"} s={s} org={slug} repos={s.id ? reposBySegment[s.id] ?? [] : []} />
          ))}
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div>
        <SectionHeader
          title="Compare segments"
          description="Two slices side by side — e.g. platform is AI-Native while legacy is Experimental."
          right={<SegmentComparePicker options={options} a={aId} b={bId} />}
        />
        <SegmentComparisonView comparison={comparison} noun="segment" />
      </div>
    </div>
  );
}
