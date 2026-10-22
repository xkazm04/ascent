"use client";

// The whole-trail integrity strip above the audit table: one action, "Verify all matching entries",
// and the verdict over every row matching the applied filters (not just the rows loaded below). The
// words come from auditIntegrityModel.ts; this file only places them. A tampered verdict is announced
// (role=alert); every other verdict is a polite status, and `unsigned` is never painted as an alarm.
// Before a check runs the strip carries no live role, so it never competes with the table's own
// "Loading…" status.

import { integrityStripState, type AuditIntegritySummary, type IntegrityStripState } from "./auditIntegrityModel";

const TONE: Record<IntegrityStripState["tone"], string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  neutral: "border-slate-700 bg-slate-800/40 text-slate-300",
  caution: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  alarm: "border-red-500/40 bg-red-500/10 text-red-300",
};

const BUTTON =
  "focus-ring rounded-lg border border-slate-700 px-3 py-1 type-body-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50";

export function AuditIntegrityStrip({
  summary,
  stale,
  loading,
  error,
  showingTampered,
  onVerify,
  onShowTampered,
}: {
  summary: AuditIntegritySummary | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  showingTampered: boolean;
  onVerify: () => void;
  onShowTampered: () => void;
}) {
  const state = summary ? integrityStripState(summary) : null;
  const verifyLabel = loading ? "Verifying…" : state ? "Verify again" : "Verify all matching entries";

  return (
    <div
      data-testid="integrity-strip"
      role={state ? (state.tone === "alarm" ? "alert" : "status") : undefined}
      aria-busy={loading}
      className={`mb-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-2 type-body ${
        state ? TONE[state.tone] : TONE.neutral
      }`}
    >
      <div className="min-w-0 flex-1">
        {state ? (
          <>
            <div>{state.headline}</div>
            {state.detail && <div className="mt-0.5 type-body-sm opacity-80">{state.detail}</div>}
          </>
        ) : (
          <div className="type-body-sm text-slate-400">
            {stale
              ? "The filters changed, so the last check no longer applies to these entries. Verify again to check them."
              : "The badges below cover only the entries loaded so far. Check every entry matching the applied filters in one pass."}
          </div>
        )}
        {error && <div className="mt-0.5 type-body-sm text-red-300">{error}</div>}
      </div>
      <div className="flex shrink-0 gap-2">
        {state?.action === "show-tampered" && !showingTampered && (
          <button type="button" onClick={onShowTampered} className={BUTTON}>
            {state.actionLabel}
          </button>
        )}
        <button type="button" onClick={onVerify} disabled={loading} className={BUTTON}>
          {verifyLabel}
        </button>
      </div>
    </div>
  );
}
