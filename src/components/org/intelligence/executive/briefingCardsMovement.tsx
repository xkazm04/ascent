// Split out of briefingCards.tsx to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md).
// Re-exported from briefingCards.tsx (the pinned import path both the exec tab and the public
// /share/briefing/[token] page use) so no call site changes. Same "public by default" prop contract —
// see the header comment in briefingCards.tsx.

import { Card, InlineEmpty, Meter, SectionHeader } from "@/components/org/shared/ui";
import { MoveRow } from "./briefingShared";
import { scoreHex } from "@/lib/ui";
import type { BriefingGoal, BriefingMove, ExecBriefing } from "@/lib/org/briefing";

/**
 * "Movement this period" — the capped top movers. Renders nothing when neither list has rows.
 *
 * `reportLinks` is exec-only: it forwards each mover's `fullName` so the row links to that repo's stored
 * report. The public page leaves it false, so no /report/… links leak out of the read-only surface
 * (briefingShared's recorded intent: the link surface stays inside the authenticated app).
 *
 * `movement` (the fleet-wide scale line) is the one prop the PUBLIC page passes and the exec page does
 * not — the exec page already carries the same numbers in its fleet-signals strip above.
 */
export function BriefingMovementCard({
  gainers,
  regressions,
  movement = null,
  reportLinks = false,
  className = "",
}: {
  gainers: BriefingMove[];
  regressions: BriefingMove[];
  /** Fleet-wide movement scale, rendered above the rows when `compared > 0`. */
  movement?: ExecBriefing["movement"] | null;
  /** Exec-only: link each mover to its report permalink. */
  reportLinks?: boolean;
  className?: string;
}) {
  if (gainers.length === 0 && regressions.length === 0) return null;
  return (
    <Card className={className}>
      <SectionHeader size="sm" title="Movement this period" />
      {movement && movement.compared > 0 && (
        <p className="mt-2 font-mono text-sm text-slate-500">
          {movement.up + movement.down} of {movement.compared} compared repos moved
          ({movement.up} ▲ / {movement.down} ▼)
        </p>
      )}
      <div className="mt-3 space-y-1.5">
        {gainers.map((m) => (
          <MoveRow
            key={`g-${m.name}`}
            tone="up"
            name={m.name}
            fullName={reportLinks ? m.fullName : undefined}
            d={m.dOverall}
            from={m.levelFrom}
            to={m.levelTo}
          />
        ))}
        {regressions.map((m) => (
          <MoveRow
            key={`r-${m.name}`}
            tone="down"
            name={m.name}
            fullName={reportLinks ? m.fullName : undefined}
            d={m.dOverall}
            from={m.levelFrom}
            to={m.levelTo}
          />
        ))}
      </div>
    </Card>
  );
}

/**
 * The "Goals" card. `emptyText` is required because the two pages word the empty state for their own
 * audience (the exec page points at the Plan tab; the public page just states the fact). `right` is the
 * exec-only header action ("Manage goals →") — an anonymous viewer has nowhere to manage anything.
 */
export function BriefingGoalsCard({
  goals,
  emptyText,
  right,
  className = "",
}: {
  goals: BriefingGoal[];
  emptyText: React.ReactNode;
  /** Exec-only header slot. */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <SectionHeader size="sm" title="Goals" right={right} />
      {goals.length === 0 ? (
        <InlineEmpty>{emptyText}</InlineEmpty>
      ) : (
        <div className="mt-3 space-y-2.5">
          {goals.map((g) => (
            <div key={g.label} className="flex items-center gap-3 text-base">
              <span className="min-w-0 flex-1 truncate text-slate-300">{g.label}</span>
              <Meter className="w-32 shrink-0" value={g.pct} color={scoreHex(g.pct)} />
              <span className="w-28 shrink-0 text-right font-mono text-sm text-slate-400">
                {g.current}/{g.target}
                {g.etaDays != null ? ` · ~${g.etaDays}d` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
