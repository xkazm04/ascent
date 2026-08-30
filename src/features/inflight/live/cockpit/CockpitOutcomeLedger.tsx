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

import { deltaHex, fmtDelta } from "@/components/ui";
import { dimShort } from "@/lib/ui";
import { attributeDimension, attributionLabel, integrityNotes } from "@/lib/maturity/attribution";
import { platformFoldNote } from "@/lib/analyze/platform-carry";
import { fmtMicrosPerPoint, laneEconomics } from "@/lib/local/lane-economics";
import { LanePrAction } from "./LanePrAction";
import { laneAttribution } from "./cockpitDrift";
import { laneKindTag, type LoopLaneOutcome } from "./loopTypes";

/** The engine + integrity provenance line. Renders nothing when there is nothing to disclose. */
function ProvenanceLine({ outcome }: { outcome: LoopLaneOutcome }) {
  const end = outcome.after ?? outcome.before;
  if (!end) return null;
  const notes = integrityNotes(end.scoreIntegrity);
  // Where this lane's D2/D3/D4 credit came from. A loop rescan cannot observe the GitHub-side
  // signals, so it either replays the last scan that could (naming it and its age) or says the
  // dimensions were not measurable — and the operator is entitled to know which, because it is the
  // difference between a score that is comparable with the fleet's and one that is not.
  const fold = platformFoldNote(end.platformSignals);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-600">
      <span title={`The engine that produced this lane's after-scan${end.engineDegraded ? " — after the requested model failed" : ""}`}>
        engine {end.engineProvider}
        {end.engineModel ? ` · ${end.engineModel}` : ""}
        {end.engineDegraded ? " (degraded)" : ""}
      </span>
      {fold && (
        <span
          className="cursor-help rounded-sm border border-divider px-1.5 text-slate-500"
          title="D2/D3/D4 are credited partly for tooling that is installed rather than committed (review, CI and coverage Apps posting check suites; default-branch Actions health). A scan run from the loop's worktree cannot observe any of it, so it replays the last scan that could — or says so."
        >
          {fold}
        </span>
      )}
      {notes.map((n) => (
        <span key={n.label} className="cursor-help rounded-sm border border-divider px-1.5 text-amber-400/80" title={n.hint}>
          {n.label}
          <span className="sr-only">. {n.hint}</span>
        </span>
      ))}
    </p>
  );
}

export function OutcomeRow({
  outcome,
  slug,
  canOpenPr = false,
}: {
  outcome: LoopLaneOutcome;
  /** Present only where the PR action can be offered — see LanePrAction's visibility matrix. */
  slug?: string;
  canOpenPr?: boolean;
}) {
  const { lane, before, after, diff } = outcome;
  const moved = (diff?.dimensions ?? []).filter((d) => d.delta != null && d.delta !== 0);
  const verdict = laneAttribution(outcome);
  const refusal = attributionLabel(verdict);
  // What this lane DID, so a row with no agent session in it does not read as one that failed to
  // produce commits. Resolved server-side off the run's targets, never guessed from the lane's shape.
  const tag = laneKindTag(outcome.kind);
  // Folded HERE rather than taken as a prop: `laneEconomics` is pure and takes exactly the outcome
  // this row already holds, so passing it down would only create a way for the two to disagree.
  const econ = laneEconomics(outcome);

  return (
    <li className="bg-ink px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-mono text-sm text-slate-200" title={lane.repoFullName}>
          {lane.repoFullName}
          {tag && (
            <span className="ml-2 rounded-sm border border-accent/40 px-1.5 font-sans text-[0.65rem] uppercase tracking-wide text-accent">
              {tag}
            </span>
          )}
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
          {moved.map((d) => {
            // A per-dimension delta inherits the row's verdict — if the PAIR cannot be attributed,
            // neither can any movement inside it, and colouring one green here would restate the
            // claim the line above just declined to make. It ALSO has to clear its own check: a
            // dimension the two ends folded the platform signals differently on moved because one
            // scan could see GitHub and the other could not, which is not work the loop did.
            const claimable =
              verdict.kind === "attributable" &&
              attributeDimension(d.id, d.delta, before, after).kind === "attributable";
            return (
              <li key={d.id} className="font-mono text-xs tabular-nums">
                <span className="text-slate-500">{dimShort(d.id)}</span>{" "}
                <span
                  style={{ color: claimable ? deltaHex(d.delta ?? 0) : undefined }}
                  className={claimable ? undefined : "text-slate-600"}
                  title={claimable ? undefined : "Not attributable to this run — see the row's verdict and the platform-signal provenance below."}
                >
                  {fmtDelta(d.delta ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-1.5 font-mono text-xs tabular-nums text-slate-500">
        {diff ? `${diff.closedGapCount} gaps closed` : "no diff"} · {outcome.closedFollowUpIds.length} follow-ups closed ·{" "}
        {outcome.commits} commits
        {lane.branch && <span className="ml-2 text-slate-600">{lane.branch}</span>}
      </p>

      {/* WHAT THE MOVEMENT COST. Folded from this row's OWN pair by the same pure function the price
          list uses, so the ratio and the arrow above it can never come from two readings. Null is
          printed as "not measured" in the row's existing absent-value idiom — never as a zero, and
          never coloured: a ratio is not signed movement, so `deltaHex` stays out of it. */}
      <p className="mt-1 font-mono text-xs tabular-nums text-slate-600">
        {econ.costMicros == null ? (
          <span data-testid="lane-ratio">cost not measured</span>
        ) : (
          <span data-testid="lane-ratio">
            {fmtMicrosPerPoint(econ.costMicros)} spent ·{" "}
            {econ.microsPerVerifiedPoint == null
              ? econ.unproductive
                ? "no measured movement"
                : "¢/point not measured"
              : `${fmtMicrosPerPoint(econ.microsPerVerifiedPoint)}/point`}
          </span>
        )}
      </p>

      <ProvenanceLine outcome={outcome} />

      {(diff?.movements ?? []).slice(0, 2).map((line) => (
        <p key={line} className="mt-1 text-xs leading-relaxed text-slate-400">
          {line}
        </p>
      ))}

      {lane.phase === "error" && lane.error && <p className="mt-1 font-mono text-xs text-danger">{lane.error}</p>}

      {/* The branch is the deliverable; this is where it stops being one only a laptop can see. The
          action renders nothing unless the lane finished, has a branch, landed commits and has no PR
          yet — and it asks for the repo name to be typed, because it is the one loop control whose
          effect leaves the machine. */}
      {slug && <LanePrAction slug={slug} lane={lane} canOpen={canOpenPr} />}
    </li>
  );
}


// The header tally lives in a sibling file (200-LOC cap) and is re-exported here so every existing
// import of `OutcomeTotals` from this module is unchanged.
export { OutcomeTotals } from "./CockpitOutcomeTotals";
