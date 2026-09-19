// PURE transition detection over the control ledger (moonshot #1).
//
// The ledger already stamps `transition: true` on the row that changed (W3-L's contract §3), so this
// module does NOT re-derive "did something change". It answers the next question, which the ledger
// deliberately does not: is this change WORTH PAGING SOMEONE, and what should the page say.
//
// Three codes, and the third one is the point of the whole item:
//
//   control-failed        pass → fail. Somebody turned a control off. Critical.
//   control-restored      fail → pass. Somebody turned it back on. Celebration.
//   control-unmeasurable  pass|fail → unmeasurable. We STOPPED BEING ABLE TO SEE the control.
//
// `control-unmeasurable` exists so that a lost read is never dressed up as a failure. A token that
// lost a scope, a repo turned private, a GitHub 403 — all of these turn a `pass` into "we don't
// know", and reporting that as `control-failed` would page a team about a control that is very
// probably still on. It is `info`, and the dispatcher never sends it to a sink.
//
// Symmetrically, `unmeasurable → fail` is NOT a `control-failed`: we did not watch a control get
// turned off, we regained the ability to look and found it off. It is reported as a fail-state
// arrival, because the finding is real — but the actor is unknown and the message says so.

import type { ControlState } from "@/lib/db/control-observations";

export type ControlTransitionCode = "control-failed" | "control-restored" | "control-unmeasurable";

export interface ControlSnapshotEntry {
  controlId: string;
  state: ControlState;
  value: string | null;
}

/** One repo's control posture at an instant: control id → (state, value). */
export interface ControlSnapshot {
  repoFullName: string;
  entries: readonly ControlSnapshotEntry[];
}

export interface ControlTransition {
  controlId: string;
  repoFullName: string;
  code: ControlTransitionCode;
  from: ControlState;
  to: ControlState;
  /** The values either side, so a 2 → 1 approvals move is legible even though both states are `pass`. */
  fromValue: string | null;
  toValue: string | null;
  /** ISO instant. Null when the caller had no observation time to give — never `new Date()`: this
   *  module has no clock, and a fabricated stamp on an evidence row is worse than an absent one. */
  at: string | null;
  /** GitHub login, webhook-sourced only. Null on scan/probe transitions — nobody performed those in
   *  a way we observed, and naming a random actor on a probe row is exactly the fabrication the
   *  ledger's `actorLogin` column is documented to refuse. */
  actorLogin: string | null;
}

/** How loud each code is. `control-unmeasurable` is `info` AND is never dispatched to a sink — flaky
 *  token access must not page anyone (see scan-alerts.ts). */
export const TRANSITION_SEVERITY: Record<ControlTransitionCode, "critical" | "info" | "celebration"> = {
  "control-failed": "critical",
  "control-restored": "celebration",
  "control-unmeasurable": "info",
};

/** True when a code should reach a configured sink. Only the loud two. */
export function isDispatchable(code: ControlTransitionCode): boolean {
  return code !== "control-unmeasurable";
}

/**
 * Classify one (from → to) state move, or null when it is not an alertable transition.
 *
 * Deliberately NOT alertable:
 *   • same state (a value-only move, e.g. approvals 2 → 1). It IS a ledger transition — the row is
 *     written and the timeline shows it — but paging on every value nudge would bury the flips. The
 *     value change is carried on the transition record when the state also moved.
 *   • `unmeasurable → pass`. Regaining a read that finds the control on is good news about our
 *     ACCESS, not about the org's controls, and celebrating it would train readers to ignore
 *     `control-restored`.
 */
export function classifyMove(from: ControlState, to: ControlState): ControlTransitionCode | null {
  if (from === to) return null;
  if (to === "unmeasurable") return "control-unmeasurable";
  // `unmeasurable → fail` lands here too, and deliberately: the finding is real even though nobody
  // watched it happen. The message carries `from` so a reader can tell the two apart.
  if (to === "fail") return "control-failed";
  // to === "pass"
  return from === "fail" ? "control-restored" : null;
}

/**
 * Every alertable transition between two snapshots of one repo.
 *
 * A control present in `next` but ABSENT from `prev` yields nothing: that is a baseline, not a
 * change — we merely started looking. This is the same rule the ledger's `transition` flag follows
 * (W3-L contract §3), restated here because this function is also reachable from callers that build
 * snapshots by hand (W1-A's doctor path) and never touch the ledger's writer.
 *
 * Results are sorted by catalogue-independent id order so the output is stable for tests and for a
 * message body a human reads twice.
 */
export function detectControlTransitions(
  prev: ControlSnapshot,
  next: ControlSnapshot,
  opts?: { at?: string | null; actorLogin?: string | null },
): ControlTransition[] {
  const before = new Map(prev.entries.map((e) => [e.controlId, e]));
  const out: ControlTransition[] = [];
  for (const e of next.entries) {
    const was = before.get(e.controlId);
    if (!was) continue; // baseline — nothing transitioned
    const code = classifyMove(was.state, e.state);
    if (!code) continue;
    out.push({
      controlId: e.controlId,
      repoFullName: next.repoFullName,
      code,
      from: was.state,
      to: e.state,
      fromValue: was.value,
      toValue: e.value,
      at: opts?.at ?? null,
      actorLogin: opts?.actorLogin ?? null,
    });
  }
  return out.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

/**
 * The same classification read off ledger ROWS rather than off two snapshots — the shape the alert
 * path actually has, because `listObservationsSince(org, since, { transitionsOnly: true })` already
 * hands back rows carrying their own `prevState`/`prevValue`.
 *
 * Rows whose `prevState` is null are skipped for the baseline reason above.
 */
export function transitionsFromRows(
  rows: readonly {
    controlId: string;
    repoFullName: string;
    state: ControlState;
    value: string | null;
    prevState: ControlState | null;
    prevValue: string | null;
    occurredAt: string;
    actorLogin: string | null;
  }[],
): ControlTransition[] {
  const out: ControlTransition[] = [];
  for (const r of rows) {
    if (r.prevState === null) continue;
    const code = classifyMove(r.prevState, r.state);
    if (!code) continue;
    out.push({
      controlId: r.controlId,
      repoFullName: r.repoFullName,
      code,
      from: r.prevState,
      to: r.state,
      fromValue: r.prevValue,
      toValue: r.value,
      at: r.occurredAt,
      actorLogin: r.actorLogin,
    });
  }
  return out;
}
