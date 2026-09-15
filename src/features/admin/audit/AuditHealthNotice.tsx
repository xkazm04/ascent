// The audit trail's own honesty notice: this instance dropped N audit writes, so what the table below
// shows is INCOMPLETE.
//
// Audit writes are best-effort by design (recordAudit catches and returns false; the claim helpers fail
// closed) — losing a row must never fail the scan or the digest that produced it. The gap that left was
// that a lost row was invisible outside a server log: no counter, no metric, nothing on any surface. This
// is that surface, and it sits on the tab whose whole purpose is that someone reads the trail.
//
// Styled like the tamper banner in AuditLogTable.tsx and deliberately in the same red family: "rows are
// missing" and "a row was altered" are the same class of statement about the evidence, and a reader
// deciding whether to file this trail needs both to read as loudly.
//
// No hooks, no handlers — this stays a SERVER component so AuditTab (also a server component) can render
// it without dragging the tab across the client boundary.

import type { AuditHealth } from "@/lib/db/audit-health";

/** Absolute UTC instant, not a relative "3h ago": this renders on the server, and an evidence surface
 *  should state a time an examiner can quote. Format is fixed, so nothing depends on the viewer's locale. */
function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function AuditHealthNotice({ health }: { health: AuditHealth }) {
  // Nothing has failed on this instance — say nothing. A permanent "0 failures" badge would train the
  // reader to skim exactly the region that matters when it stops being 0.
  if (health.failed <= 0) return null;

  const n = health.failed;

  return (
    <div
      role="alert"
      className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 type-body text-red-300"
    >
      <span className="type-mono-sm uppercase tracking-widest">Audit gap</span>:{" "}
      {n} audit {n === 1 ? "write has" : "writes have"} failed on this instance
      {health.since ? ` since ${stamp(health.since)}` : ""} — the trail below has known gaps and is not a
      complete record of what happened.{" "}
      {health.lastAction ? (
        <>
          Most recent: <span className="type-mono-sm">{health.lastAction}</span>
          {health.lastError ? ` (${health.lastError})` : ""}.{" "}
        </>
      ) : null}
      <span className="text-red-300/70">
        Counted per process, so a restart resets it and other instances keep their own tally.
      </span>
    </div>
  );
}
