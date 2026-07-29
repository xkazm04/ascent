// One segment's headline standing — the per-segment rollup card in the Segments overview strip. Real
// segments (with an id) also get scan + cadence controls scoped to their tagged repos. Extracted out
// of SegmentsSection.tsx so that file stays under the 200-LOC cap (AGENTS.md).

import { SegmentActions } from "./SegmentActions";
import { POSTURE_LABEL } from "@/components/org/shared/ui";
import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import type { SegmentSummary } from "@/lib/db";

// Human posture label with a raw-id fallback. Deliberately the lookup-then-`?? raw` form (NOT the
// shared postureLabel(), which title-cases an unknown id) so the existing rendering is preserved
// exactly — the data layer only ever yields known posture ids, so the branches agree in practice.
export const postureText = (posture: string) => POSTURE_LABEL[posture] ?? posture;

export function SegmentCard({ s, org, repos, taggedCount }: { s: SegmentSummary; org: string; repos: string[]; taggedCount: number }) {
  const level = levelForScore(s.avgOverall);
  // repositories-segments #4: a segment with ZERO scanned repos reduces to avgOverall 0 — a sentinel,
  // not a measurement. Rendering it through scoreHex/levelForScore painted a brand-new segment as an
  // alarming rock-bottom red 0 with a posture chip, indistinguishable from a genuinely terrible one.
  const unscanned = s.scannedCount === 0;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-white">{s.name}</span>
        {!unscanned && <span className="font-mono text-sm uppercase tracking-widest text-slate-500">{postureText(s.posture)}</span>}
      </div>
      {unscanned ? (
        <div className="mt-2 flex items-baseline gap-2">
          <span aria-hidden className="font-mono text-3xl font-bold text-slate-600">—</span>
          <span className="font-mono text-sm text-slate-500">No scans yet — scan this segment to score it</span>
        </div>
      ) : (
        <>
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
        </>
      )}
      {/* G4-08: repoCount here is the watched-or-scanned rollup universe, NOT every repo tagged into the
          segment (that count lives on the Repositories tab's tagging chips) — the title disambiguates
          so the two screens' numbers are never read as contradicting each other. */}
      <div className="mt-1 font-mono text-sm text-slate-600" title="Repos in this segment that are watched or have a scan — may be fewer than the total tagged into the segment">
        {s.scannedCount}/{s.repoCount} scanned
      </div>
      {s.id && <SegmentActions org={org} segmentId={s.id} repos={repos} taggedCount={taggedCount} />}
    </div>
  );
}
