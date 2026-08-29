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
import { attributeDimension, attributionLabel, integrityNotes } from "@/lib/maturity/attribution";
import { platformFoldNote } from "@/lib/analyze/platform-carry";
import { laneAttribution, type RunAttribution } from "./cockpitDrift";
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

export function OutcomeRow({ outcome }: { outcome: LoopLaneOutcome }) {
  const { lane, before, after, diff } = outcome;
  const moved = (diff?.dimensions ?? []).filter((d) => d.delta != null && d.delta !== 0);
  const verdict = laneAttribution(outcome);
  const refusal = attributionLabel(verdict);
  // What this lane DID, so a row with no agent session in it does not read as one that failed to
  // produce commits. Resolved server-side off the run's targets, never guessed from the lane's shape.
  const tag = laneKindTag(outcome.kind);

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
  excluded: Pick<RunAttribution, "withinNoise" | "mock" | "unmeasured" | "undelivered">;
}) {
  const parts = [
    excluded.withinNoise > 0 ? `${excluded.withinNoise} within noise` : null,
    excluded.mock > 0 ? `${excluded.mock} mock ${excluded.mock === 1 ? "scan" : "scans"}` : null,
    excluded.unmeasured > 0 ? `${excluded.unmeasured} not measured` : null,
    excluded.undelivered > 0 ? `${excluded.undelivered} uncommitted` : null,
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
          title="Held out of the lift: a movement smaller than the measured run-to-run noise band, or one measured across a scan that fell to the deterministic mock floor, is not evidence the repository changed. Neither is a movement a lane never committed — the loop scans a worktree it then deletes, so an uncommitted lane measured a state that no longer exists."
        >
          excluded: {parts.join(" · ")}
        </span>
      )}
    </div>
  );
}
