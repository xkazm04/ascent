// THE COMPARISON — the one place the feature's whole question is answered: can real work be delegated
// off Claude when the plan needs to slow down.
//
// It reads top to bottom as the verdict reads: which arm advances (or why none did), the declared
// constraints with their thresholds, then the arms side by side each carrying its own contract. The
// numbers here are persuasive precisely because they came from real lanes doing real work, which is
// why every omission this surface could make is one the components below refuse to make:
// a conditioned cost cannot print without its subset size, both reliability figures render or neither
// does, and a void lane is an outcome with a reason rather than a missing row.
//
// THREE STATES. Empty (no comparison has run), running (arms exist, metric not final — and NO
// provisional headline, because a number that will change is a number someone will quote), settled.
//
// Pure: no hooks, no handlers, no "use client" — a server render and a DOM test see the same markup.

import { Kicker } from "@/components/ui";
import type { ComparisonReport } from "@/lib/local/compare-metrics";
import { LedgerSectionHeader } from "../LedgerSectionHeader";
import { ComparisonArm } from "./ComparisonArm";
import { ComparisonConstraints } from "./ComparisonConstraints";
import { NO_ADVANCE_FALLBACK, OPTIMIZED_DIRECTION } from "./comparisonFormat";

const ABOUT =
  "One metric is optimized — Claude tokens per verified point, lower is better — and every other declared metric is a threshold that is either cleared or not. Both were declared before the run.";

export interface ComparisonViewProps {
  /** Null = no comparison has been run for this org yet. */
  report: ComparisonReport | null;
  /**
   * The arms are still running. The committed `ComparisonReport` carries no status field, so the
   * caller — which knows whether the run has settled — says so here rather than the view guessing
   * from a half-filled report.
   */
  running?: boolean;
}

function Verdict({ report }: { report: ComparisonReport }) {
  const winner = report.advance ? report.arms.find((a) => a.armId === report.advance) : null;
  if (report.advance && winner) {
    return (
      <p data-testid="comparison-verdict" className="type-title text-white">
        <span className="font-semibold">{winner.label}</span> advances — best on {report.optimized.label} ({OPTIMIZED_DIRECTION}) with no
        constraint breached.
      </p>
    );
  }
  return (
    <div data-testid="comparison-no-advance" className="flex flex-col gap-1">
      <p className="type-title text-amber-300">No arm advances.</p>
      <p className="type-body-sm text-slate-300">{report.note || NO_ADVANCE_FALLBACK}</p>
    </div>
  );
}

export function ComparisonView({ report, running = false }: ComparisonViewProps) {
  return (
    <section id="ledger-comparison" aria-labelledby="ledger-comparison-h" data-testid="comparison" className="scroll-mt-24 space-y-3">
      <LedgerSectionHeader
        id="ledger-comparison-h"
        title="Arm comparison"
        about={ABOUT}
        count={report ? `${report.arms.length} arms` : null}
      />

      {report == null ? (
        <p data-testid="comparison-empty" className="type-body-sm text-slate-400">
          No comparison has run yet. Arm two or more configurations from the Cockpit and they will race the same curated batch.
        </p>
      ) : (
        <div className="space-y-4">
          {running ? (
            <p data-testid="comparison-running" className="type-body-sm text-slate-300">
              The arms are still running. The optimized metric is withheld until the batch settles — a provisional headline is a number
              someone will quote after it has changed.
            </p>
          ) : (
            <Verdict report={report} />
          )}

          <div className="space-y-2">
            <Kicker tone="muted">Declared constraints</Kicker>
            <ComparisonConstraints verdicts={report.constraints} />
          </div>

          <div className="grid gap-px bg-divider md:grid-cols-2">
            {report.arms.map((arm) => (
              <ComparisonArm key={arm.armId} arm={arm} advanced={!running && report.advance === arm.armId} pending={running} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
