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
// A null posture is a scope with no scanned repo: the producer no longer classifies one from two
// sentinel zeros (`postureOf`, src/lib/db/segments.ts), so there is no label to print.
export const postureText = (posture: string | null) => (posture === null ? "Not classified" : POSTURE_LABEL[posture] ?? posture);

export function SegmentCard({ s, org, repos, taggedCount }: { s: SegmentSummary; org: string; repos: string[]; taggedCount: number }) {
  // repositories-segments #4: a segment with ZERO scanned repos has no average. It used to reduce to
  // avgOverall 0 — a sentinel, not a measurement — and rendering that through scoreHex/levelForScore
  // painted a brand-new segment as an alarming rock-bottom red 0 with a posture chip, indistinguishable
  // from a genuinely terrible one. The average is `null` at the producer now, so this reads the field
  // it draws instead of inferring the absence from `scannedCount`, and `levelForScore` is only reached
  // when there is a score to level.
  const score = s.avgOverall;
  const level = score === null ? null : levelForScore(score);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-white">{s.name}</span>
        {s.posture !== null && <span className="type-mono-sm uppercase tracking-widest text-slate-500">{postureText(s.posture)}</span>}
      </div>
      {score === null || level === null ? (
        <div className="mt-2 flex items-baseline gap-2">
          <span aria-hidden className="type-figure-lg font-bold text-slate-600">—</span>
          <span className="type-mono-sm text-slate-500">No scans yet, scan this segment to score it</span>
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="type-figure-lg font-bold" style={{ color: scoreHex(score) }}>
              {score}
            </span>
            <span className="type-mono-sm text-slate-500">{level.id} · {level.name}</span>
          </div>
          <div className="mt-2 flex gap-4 type-mono-sm text-slate-400">
            <span>adopt {s.avgAdoption ?? "—"}</span>
            <span>rigor {s.avgRigor ?? "—"}</span>
          </div>
        </>
      )}
      {/* G4-08: repoCount here is the watched-or-scanned rollup universe, NOT every repo tagged into
          the segment (that count is the one on the "Create & tag" chips directly above this strip) —
          the title disambiguates so the two numbers are never read as contradicting each other. They
          now sit on ONE screen, so the disambiguation matters more, not less. */}
      <div className="mt-1 type-mono-sm text-slate-600" title="Repos in this segment that are watched or have a scan (may be fewer than the total tagged into the segment)">
        {s.scannedCount}/{s.repoCount} scanned
      </div>
      {s.id && <SegmentActions org={org} segmentId={s.id} repos={repos} taggedCount={taggedCount} />}
    </div>
  );
}
