// Accounting for audit writes that FAILED.
//
// Every audit write in this codebase is best-effort by design: `recordAudit` catches and returns false,
// `claimOrgAuditOnce` fails closed, `releaseAuditClaim` swallows. That is the right trade-off — losing an
// audit row must never fail the scan, the digest or the mutation that produced it. But best-effort
// without accounting is just silent loss: of the ~31 non-test call sites only three read the returned
// boolean, and a dropped row left no counter, no metric, no alert and nothing in the UI. The trail simply
// had a hole, and the only witness was a server log nobody reads.
//
// So the write stays best-effort AND every failure is counted here, then surfaced on the org's Audit tab
// (AuditHealthNotice) — the surface whose whole purpose is that someone looks at the trail.
//
// Deliberately PROCESS-LOCAL and dependency-free: module state, no DB (a failure counter that needs the
// database is useless in exactly the outage it exists to record), no timers, no imports. The counter
// therefore resets when the process does and describes THIS instance only — which is why the notice says
// "on this instance" rather than implying a fleet-wide total it cannot know.

/** A snapshot of this process's audit-write failures. Timestamps are ISO strings, never `Date`. */
export interface AuditHealth {
  /** How many audit writes have failed in this process since it started. */
  failed: number;
  /** ISO instant of the FIRST failure, or null when there has been none. */
  since: string | null;
  /** The action of the most recent failed write, for a one-glance "what is dropping". */
  lastAction: string | null;
  /** The most recent failure's message (never the error object — this crosses to a client). */
  lastError: string | null;
}

let failed = 0;
let since: string | null = null;
let lastAction: string | null = null;
let lastError: string | null = null;

/**
 * Record that ONE audit write failed. Called from every catch site that swallows a write
 * (`recordAudit`, `claimOrgAuditOnce`, `releaseAuditClaim`). Must never throw: it runs inside a catch
 * block whose entire contract is that the caller carries on.
 */
export function noteAuditWriteFailure(action: string, err: unknown): void {
  failed += 1;
  const now = new Date().toISOString();
  if (!since) since = now;
  lastAction = action;
  lastError = err instanceof Error ? err.message : String(err);
}

/** This process's audit-write failure accounting. Cheap — safe to call on every render of the tab. */
export function getAuditHealth(): AuditHealth {
  return { failed, since, lastAction, lastError };
}

/** Test-only: clear the counter so cases don't inherit each other's failures. */
export function resetAuditHealth(): void {
  failed = 0;
  since = null;
  lastAction = null;
  lastError = null;
}
