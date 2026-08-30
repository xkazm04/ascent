"use client";

// OUTCOME mode — what the run actually did, and the two ways out of it: replay the field's drift, or
// go back to the inspector with the selection still intact (the run you just watched is usually the
// selection you want to iterate on, so throwing it away would be hostile).

import { Kicker } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import { agentConfigLabel } from "@/lib/local/agent-options";
import { OutcomeRow, OutcomeTotals } from "./CockpitOutcomeLedger";
import { laneAttribution, runAttribution } from "./cockpitDrift";
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
  // improved / flat / regressed count ATTRIBUTABLE movements only, on the same rule as the lift above
  // them. Counting raw sign here would have the tally contradict the number it sits beside — three
  // "improved" repos under a headline of "—" is the confusion the whole rule exists to remove. A lane
  // held out for noise or a mock end lands in `flat`, and the excluded breakdown names which.
  const totals = runAttribution(detail);
  const verdicts = outcomes.map(laneAttribution);
  const improved = verdicts.filter((v) => v.kind === "attributable" && v.delta > 0).length;
  const regressed = verdicts.filter((v) => v.kind === "attributable" && v.delta < 0).length;
  // A lane that committed nothing is not "flat" — it is EXCLUDED, and the breakdown beside the
  // headline names it. Counting it as flat would put a lost deliverable in the same bucket as a repo
  // the run legitimately did not move (L2-B-01).
  const measured = outcomes.filter((o) => o.before && o.after && o.commits > 0);
  const agentConfig = agentConfigLabel(run);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Outcome · {run.phase}</Kicker>
        <span className="type-caption text-slate-500">
          {/* WHAT THE LIFT WAS PRODUCED UNDER. A lift on sonnet at the deployment's default effort and
              one on opus at high effort are results from two different setups, and the ledger compared
              them for months without recording which was which. Absent on a run written before the
              columns existed — unknown, rendered as nothing rather than as "default". */}
          {agentConfig && <span className="mr-2 text-slate-400">{agentConfig}</span>}
          {timeAgo(run.endedAt ?? run.startedAt)}
        </span>
      </div>
      <OutcomeTotals
        lift={totals.lift}
        improved={improved}
        flat={measured.length - improved - regressed}
        regressed={regressed}
        excluded={totals}
      />
      {run.error && <p className="mt-2 type-caption text-danger">{run.error}</p>}

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
          className="focus-ring flex-1 rounded-md border border-accent/60 px-3 py-2 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Replay run
        </button>
        <button
          type="button"
          onClick={onBack}
          className="focus-ring flex-1 rounded-md border border-divider px-3 py-2 type-label tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
        >
          Back to inspect
        </button>
      </div>
    </div>
  );
}
