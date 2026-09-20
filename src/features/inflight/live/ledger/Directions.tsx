// DIRECTIONS — the grants approving a plan created. Active first (they are what the runner is working
// under right now), then the ended ones — exhausted, done, revoked — newest first within each.

import { InlineEmpty } from "@/components/org/shared/ui";
import { LedgerSectionHeader } from "./LedgerSectionHeader";
import { DirectionRow } from "./DirectionRow";
import { LEDGER_ANCHOR } from "./ledgerModel";
import type { LoopDirectionRecord, LoopPlanRecord } from "./ledgerTypes";

const ORDER: Record<string, number> = { active: 0, exhausted: 1, done: 2, revoked: 3 };

export function sortDirections(ds: readonly LoopDirectionRecord[]): LoopDirectionRecord[] {
  return [...ds].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.createdAt.localeCompare(a.createdAt));
}

export function Directions({
  directions,
  plans,
  now,
  isOwner,
  onSettled,
}: {
  directions: readonly LoopDirectionRecord[] | null;
  plans: readonly LoopPlanRecord[];
  now: string;
  isOwner: boolean;
  onSettled: (d: LoopDirectionRecord, action: "revoke" | "done") => void;
}) {
  return (
    <section id={LEDGER_ANCHOR.directions} aria-labelledby="ledger-directions-h" className="scroll-mt-24 space-y-3">
      <LedgerSectionHeader
        id="ledger-directions-h"
        title="Directions"
        count={directions && directions.length > 0 ? `${directions.filter((d) => d.status === "active").length} active of ${directions.length}` : null}
        about="An approved plan becomes a direction: a fence of modules and a budget that later plans run under without asking again."
      />
      {directions == null ? (
        <p role="alert" className="type-body-sm text-warn">
          Could not read the directions.
        </p>
      ) : directions.length === 0 ? (
        <InlineEmpty>None yet — approving a plan in Needs you creates one.</InlineEmpty>
      ) : (
        <ul className="divide-y divide-divider rounded-2xl border border-divider">
          {sortDirections(directions).map((d) => (
            <DirectionRow key={d.id} d={d} plans={plans.filter((p) => p.directionId === d.id)} now={now} isOwner={isOwner} onSettled={onSettled} />
          ))}
        </ul>
      )}
    </section>
  );
}
