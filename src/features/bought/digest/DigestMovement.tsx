// Which repositories actually moved this week — the one section a lead is asked to name names in.
//
// Rows are the briefing's `MoveRow` (../executive/briefingShared), not a copy: same group, and the
// digest's mover shape (name / fullName / dOverall / levelFrom / levelTo) is that component's prop
// surface exactly. `fullName` is passed, so every mover is a link into its stored report — a mover is
// a lead, and the report is where WHAT moved is legible.
//
// Two empties, kept distinct: a null `movement` means the comparison could not be READ (a degraded
// query, already printed in provenance), while two empty lists mean it was read and nothing crossed
// the noise band. Collapsing them would turn a failed read into a calm week.

import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { MoveRow } from "../executive/briefingShared";
import type { WeeklyDigest } from "@/lib/org/digest-types";

export function DigestMovement({ movement }: { movement: WeeklyDigest["movement"] }) {
  const quiet = movement != null && movement.gainers.length === 0 && movement.regressers.length === 0;
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Repository movement"
        description="Repos whose overall score crossed the noise band between the two ends of the week."
      />
      {!movement ? (
        <InlineEmpty>Repository movement could not be read this week.</InlineEmpty>
      ) : quiet ? (
        <InlineEmpty>No repository moved beyond the noise band this week.</InlineEmpty>
      ) : (
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Kicker tone="muted">Gained</Kicker>
            {movement.gainers.map((m) => (
              <MoveRow
                key={m.fullName ?? m.name}
                tone="up"
                name={m.name}
                fullName={m.fullName}
                d={m.dOverall}
                from={m.levelFrom}
                to={m.levelTo}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            <Kicker tone="muted">Slipped</Kicker>
            {movement.regressers.map((m) => (
              <MoveRow
                key={m.fullName ?? m.name}
                tone="down"
                name={m.name}
                fullName={m.fullName}
                d={m.dOverall}
                from={m.levelFrom}
                to={m.levelTo}
              />
            ))}
          </div>
        </div>
      )}
      {movement && (
        <p className="mt-3 type-caption text-slate-500">{movement.compared} repositories compared</p>
      )}
    </Card>
  );
}
