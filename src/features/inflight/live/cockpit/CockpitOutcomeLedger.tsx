"use client";

// ONE lane's outcome, as a ledger row. Everything here comes from the run detail's own `diffScans`
// output — the same diff the repo's compare view renders — so the cockpit can never claim a
// dimension moved that the report would not also show moving.
//
// AND IT ONLY PRINTS A DELTA IT CAN ATTRIBUTE. `laneAttribution` (src/lib/maturity/attribution.ts)
// decides; a pair straddling the mock floor, or moving less than the measured run-to-run noise band,
// shows the arrow and the two numbers in muted type with the verdict beside them, never a green
// figure. A lane with no `before` (a first-ever scan) shows its work — commits, closed gaps — and
// explicitly says the movement is unmeasured, rather than printing a +0 that would read as "nothing
// happened". The engine that produced the pair, and anything `scoreIntegrity` recorded, ride under
// the row: the whole point is that a reader can see WHY a number is or is not being claimed.

import { deltaHex, fmtDelta, Kicker } from "@/components/ui";
import { dimShort } from "@/lib/ui";
import { attributionLabel, integrityNotes } from "@/lib/maturity/attribution";
import { laneAttribution, type RunAttribution } from "./cockpitDrift";
import type { LoopLaneOutcome } from "./loopTypes";

/** The engine + integrity provenance line. Renders nothing when there is nothing to disclose. */
function ProvenanceLine({ outcome }: { outcome: LoopLaneOutcome }) {
  const end = outcome.after ?? outcome.before;
  if (!end) return null;
  const notes = integrityNotes(end.scoreIntegrity);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-600">
      <span title={`The engine that produced this lane's after-scan${end.engineDegraded ? " — after the requested model failed" : ""}`}>
        engine {end.engineProvider}
        {end.engineModel ? ` · ${end.engineModel}` : ""}
        {end.engineDegraded ? " (degraded)" : ""}
      </span>
      {notes.map((n) => (
        <span key={n.label} className="cursor-help rounded-sm border border-divider px-1.5 text-amber-400/80" title={n.hint}>
          {n.label}
          <span className="sr-only">. {n.hint}</span>
        </span>
      ))}
    </p>
  );
}

export function OutcomeRow({ outcome }: { outcome: LoopLaneOutcome }) {
  const { lane, before, after, diff } = outcome;
  const moved = (diff?.dimensions ?? []).filter((d) => d.delta != null && d.delta !== 0);
  const verdict = laneAttribution(outcome);
  const refusal = attributionLabel(verdict);

  return (
    <li className="bg-ink px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-mono text-sm text-slate-200" title={lane.repoFullName}>
          {lane.repoFullName}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums">
          {before && after ? (
            <>
              <span className="text-slate-500">
                {before.overallScore} → {after.overallScore}
              </span>
              {verdict.kind === "attributable" ? (
                <span className="ml-2" style={{ color: deltaHex(verdict.delta) }}>
                  {fmtDelta(verdict.delta)}
                </span>
              ) : (
                <span className="ml-2 text-slate-600">{refusal}</span>
              )}
            </>
          ) : (
            <span className="text-slate-600">not measured</span>
          )}
        </span>
      </div>

      {moved.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {moved.map((d) => (
            <li key={d.id} className="font-mono text-xs tabular-nums">
              <span className="text-slate-500">{dimShort(d.id)}</span>{" "}
              {/* A per-dimension delta inherits the row's verdict: if the PAIR cannot be attributed,
                  neither can any movement inside it, and colouring one green here would restate the
                  claim the line above just declined to make. */}
              <span style={{ color: verdict.kind === "attributable" ? deltaHex(d.delta ?? 0) : undefined }}
                className={verdict.kind === "attributable" ? undefined : "text-slate-600"}>
                {fmtDelta(d.delta ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 font-mono text-xs tabular-nums text-slate-500">
        {diff ? `${diff.closedGapCount} gaps closed` : "no diff"} · {outcome.closedFollowUpIds.length} follow-ups closed ·{" "}
        {outcome.commits} commits
        {lane.branch && <span className="ml-2 text-slate-600">{lane.branch}</span>}
      </p>

      <ProvenanceLine outcome={outcome} />

      {(diff?.movements ?? []).slice(0, 2).map((line) => (
        <p key={line} className="mt-1 text-xs leading-relaxed text-slate-400">
          {line}
        </p>
      ))}

      {lane.phase === "error" && lane.error && <p className="mt-1 font-mono text-xs text-danger">{lane.error}</p>}
    </li>
  );
}

/**
 * The three-way tally the outcome header leads with, plus what the headline number EXCLUDED. A run of
 * four one-point movements is not "+4" — the lift holds only the attributable lanes — so the counts
 * beside it are what stops that reading as "nothing happened": "no lift, 3 within noise" and "no
 * lift, 3 mock scans" are different situations calling for opposite next moves.
 */
export function OutcomeTotals({
  lift,
  improved,
  flat,
  regressed,
  excluded,
}: {
  lift: number | null;
  improved: number;
  flat: number;
  regressed: number;
  excluded: Pick<RunAttribution, "withinNoise" | "mock" | "unmeasured">;
}) {
  const parts = [
    excluded.withinNoise > 0 ? `${excluded.withinNoise} within noise` : null,
    excluded.mock > 0 ? `${excluded.mock} mock ${excluded.mock === 1 ? "scan" : "scans"}` : null,
    excluded.unmeasured > 0 ? `${excluded.unmeasured} not measured` : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="font-mono text-2xl tabular-nums" style={{ color: deltaHex(lift ?? 0) }}>
        {lift == null ? "—" : fmtDelta(lift)}
      </span>
      <Kicker tone="muted">attributable lift</Kicker>
      <span className="font-mono text-xs tabular-nums text-slate-500">
        {improved} improved · {flat} flat · {regressed} regressed
      </span>
      {parts.length > 0 && (
        <span
          className="font-mono text-xs tabular-nums text-slate-600"
          title="Held out of the lift: a movement smaller than the measured run-to-run noise band, or one measured across a scan that fell to the deterministic mock floor, is not evidence the repository changed."
        >
          excluded: {parts.join(" · ")}
        </span>
      )}
    </div>
  );
}
