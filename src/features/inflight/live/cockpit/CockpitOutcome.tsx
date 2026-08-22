"use client";

// OUTCOME mode — what the run actually did, and the two ways out of it: replay the field's drift, or
// go back to the inspector with the selection still intact (the run you just watched is usually the
// selection you want to iterate on, so throwing it away would be hostile).

import { Kicker } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import { OutcomeRow, OutcomeTotals } from "./CockpitOutcomeLedger";
import { runLift } from "./cockpitDrift";
import type { LoopRunDetail } from "./loopTypes";

export interface CockpitOutcomeProps {
  detail: LoopRunDetail;
  onReplay: () => void;
  onBack: () => void;
  /** False when the run produced no measurable pair — there is nothing to replay. */
  canReplay: boolean;
}

export function CockpitOutcome({ detail, onReplay, onBack, canReplay }: CockpitOutcomeProps) {
  const { run, outcomes } = detail;
  const measured = outcomes.filter((o) => o.before && o.after);
  const improved = measured.filter((o) => o.after!.overallScore > o.before!.overallScore).length;
  const regressed = measured.filter((o) => o.after!.overallScore < o.before!.overallScore).length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Outcome · {run.phase}</Kicker>
        <span className="font-mono text-xs text-slate-500">{timeAgo(run.endedAt ?? run.startedAt)}</span>
      </div>
      <OutcomeTotals lift={runLift(detail)} improved={improved} flat={measured.length - improved - regressed} regressed={regressed} />
      {run.error && <p className="mt-2 font-mono text-xs text-danger">{run.error}</p>}

      {outcomes.length === 0 ? (
        <InlineEmpty>This run had no lanes.</InlineEmpty>
      ) : (
        <ul className={`mt-3 ${TILE_LEDGER}`}>
          {outcomes.map((o) => (
            <OutcomeRow key={o.lane.id} outcome={o} />
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReplay}
          disabled={!canReplay}
          className="focus-ring flex-1 rounded-md border border-accent/60 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Replay run
        </button>
        <button
          type="button"
          onClick={onBack}
          className="focus-ring flex-1 rounded-md border border-divider px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
        >
          Back to inspect
        </button>
      </div>
    </div>
  );
}
