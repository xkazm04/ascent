// Which repositories actually moved this week — the one section a lead is asked to name names in.
//
// `DigestMoveAxis` draws the noise band: beyond-noise gainers/slippers sit clear of it, `held` sits
// inside it, and `onboarded` is a lifetime mark (or a name at the origin with no numeral when the
// repo has no comparable pair). Report links under the chart still own "what moved".
//
// Two empties, kept distinct: a null `movement` means the comparison could not be READ (a degraded
// query, already printed in provenance), while an empty axis means it was read and nothing was in
// any bucket. Collapsing them would turn a failed read into a calm week. Never print "0 held" or
// "0 onboarded" — omit those clauses when the bucket is empty or unmeasured.

import Link from "next/link";
import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { DigestMoveAxis } from "./DigestMoveAxis";
import { moveMarks } from "./digestViz";

export function DigestMovement({ movement }: { movement: WeeklyDigest["movement"] }) {
  if (!movement) {
    return (
      <Card>
        <SectionHeader size="sm" title="Repository movement" />
        <InlineEmpty>Repository movement could not be read this week.</InlineEmpty>
      </Card>
    );
  }

  const { marks, extent } = moveMarks(movement);
  const linked = marks.filter((m) => m.fullName);

  return (
    <Card>
      <SectionHeader size="sm" title="Repository movement" />
      {marks.length === 0 ? (
        // (O) The read succeeded and nothing crossed the band — a different claim from the one above.
        <InlineEmpty>No repository moved beyond the noise band this week.</InlineEmpty>
      ) : (
        <>
          <div className="mt-3">
            <DigestMoveAxis marks={marks} extent={extent} />
          </div>
          {linked.length > 0 && (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Kicker tone="muted" as="span">
                Reports
              </Kicker>
              {linked.map((m) => (
                <Link
                  key={m.key}
                  href={`/report/${m.fullName}`}
                  title={`Open ${m.fullName}'s report — what moved, dimension by dimension`}
                  className="focus-ring type-mono-sm text-slate-400 transition hover:text-accent"
                >
                  {m.name}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      <p className="mt-3 type-caption text-slate-500">
        {movement.compared} {movement.compared === 1 ? "repository" : "repositories"} compared
      </p>
    </Card>
  );
}
