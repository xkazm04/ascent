// Per-dimension score deltas over the trailing week: where the fleet stands now, and which way it
// moved. Deliberately NOT a DimRow (../executive/briefingShared) reuse: that row renders a score and
// an optional practice deep-link, and this one's whole point is the fourth cell — the delta, in one
// of three presentations the digest and its markdown must agree on.
//
// The three presentations, from `band` (never re-derived from the number here — the model decides):
//   up / down    → the signed, coloured move (deltaHex + fmtDelta)
//   flat         → "flat (within noise)", muted: a real measurement that did not move
//   unmeasured   → "—", muted: NOT a zero. No scan on one side of the window, so there is no delta.
// The distinction between the last two is the one a leadership update most often loses.

import { Card, InlineEmpty, Meter, SectionHeader, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { DigestDimDelta, WeeklyDigest } from "@/lib/org/digest-types";

function DeltaCell({ dim }: { dim: DigestDimDelta }) {
  if ((dim.band === "up" || dim.band === "down") && dim.delta != null) {
    return (
      <span className="type-mono-sm tabular-nums" style={{ color: deltaHex(dim.delta) }}>
        {fmtDelta(dim.delta)}
      </span>
    );
  }
  if (dim.band === "flat") return <span className="type-body-sm text-slate-500">flat (within noise)</span>;
  return <span className="type-mono-sm text-slate-500">—</span>;
}

export function DigestDimensions({ dims }: { dims: WeeklyDigest["dims"] }) {
  const noneMeasured = dims.every((d) => d.band === "unmeasured");
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Score deltas per dimension"
        description="Where each dimension stands now, and how it moved over the week. An em dash is a missing measurement, not a zero."
      />
      {noneMeasured && <InlineEmpty>No scans in this window — deltas are unmeasured.</InlineEmpty>}
      <div className="mt-3 space-y-1.5">
        {dims.map((d) => (
          <div key={d.dimId} className="flex items-center gap-3 type-body-sm">
            <span className="w-24 shrink-0 text-slate-400">
              {d.dimId} · {d.label}
            </span>
            <Meter className="flex-1" value={d.now} color={scoreHex(d.now)} ariaLabel={`${d.label} score`} />
            <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.now) }}>
              {d.now}
            </span>
            <span className="w-36 shrink-0 text-right">
              <DeltaCell dim={d} />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
