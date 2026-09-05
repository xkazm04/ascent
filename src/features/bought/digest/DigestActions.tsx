// The week's "so what": three ranked moves, with rank 1 given the accent block.
//
// Rank 1 is visually separated on purpose. A leadership update that lists three equally-weighted
// actions is a list nobody starts; the point of the ranking is that ONE of them is the next move, and
// the other two are what follows it. The rank-1 line is the same sentence the markdown export leads
// with, so the page and the pasted update cannot recommend different things.

import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import type { WeeklyDigest } from "@/lib/org/digest-types";

export function DigestActions({ actions }: { actions: WeeklyDigest["actions"] }) {
  const [first, ...rest] = actions;
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Next three actions"
        description="Ranked by projected fleet gain over the repos each one lifts."
      />
      {!first ? (
        <InlineEmpty>No open gaps across the fleet&apos;s latest scans.</InlineEmpty>
      ) : (
        <>
          <div className="mt-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
            <Kicker tone="accent">Recommended next move</Kicker>
            <p className="mt-1 type-body text-slate-200">{first.line}</p>
          </div>
          {rest.length > 0 && (
            <ol className="mt-3 space-y-1.5">
              {rest.map((a) => (
                <li key={a.rank} className="flex items-baseline gap-2 type-body-sm text-slate-300">
                  <span className="shrink-0 type-mono-sm tabular-nums text-slate-500">{a.rank}.</span>
                  <span>{a.line}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  );
}
