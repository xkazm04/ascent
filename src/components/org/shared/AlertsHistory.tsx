"use client";

// The alerts popover's "Recent alerts" section — the persisted AlertEvent history that closes the
// fire-and-forget gap: every alert the product decided to raise is listed with its delivery outcome,
// including alerts raised when NO sink was configured (before this table, those vanished without a
// trace). Member-readable (GET /api/org/alerts?history=1 — rows carry titles and outcomes, never the
// sink URL). Collapsed behind a <details> so the popover's primary jobs (movement, routing config)
// keep the space. The rows are read on mount by `useAlertHistory` (the chip's sink-health marker needs
// them before anyone opens the popover); this component only renders them.
//
// An undelivered row whose stored text is whole carries a Resend button for admins
// (fleet-alerts-digests#B): a failed weekly digest used to be lost for the week, because its retry is
// the next cron run seven days later in a new window.

import type { AlertHistoryEvent, ResendState } from "./useAlertsControl";

const KIND_EMOJI: Record<string, string> = {
  regression: "🔻",
  promotion: "🎉",
  security: "🛡️",
  "low-credits": "🪫",
  digest: "🗞️",
  "goal-at-risk": "🎯",
  "spend-anomaly": "💸",
  control: "🔐",
  test: "🧪",
};

const OUTCOME: Record<string, string> = {
  "no-sink": "not sent (no sink)",
  cooldown: "suppressed (cooldown)",
  "dispatch-failed": "delivery failed",
  // The org's sink could not be READ, so nothing was sent (never rerouted to the global sink).
  "sink-unreadable": "not sent (sink unreadable)",
};

interface AlertsHistoryProps {
  events: AlertHistoryEvent[] | null;
  failed: boolean;
  /** Admin view with the config loaded: the resend POST is admin-gated, so viewers get no button. */
  canResend: boolean;
  resends: Record<string, ResendState>;
  onResend: (id: string) => void;
}

function ResendAction({ e, state, onResend }: { e: AlertHistoryEvent; state: ResendState | undefined; onResend: (id: string) => void }) {
  if (state === "sent") return <span className="ml-1 text-emerald-400/80">resent</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => onResend(e.id)}
        disabled={state === "sending"}
        aria-label={`Resend ${e.title}`}
        className="focus-ring ml-1.5 rounded border border-slate-700 px-1.5 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
      >
        {state === "sending" ? "Resending…" : "Resend"}
      </button>
      {typeof state === "object" && <span className="ml-1 text-danger">{state.error}</span>}
    </>
  );
}

export function AlertsHistory({ events, failed, canResend, resends, onResend }: AlertsHistoryProps) {
  return (
    <details className="mb-3 border-b border-slate-800 pb-3">
      <summary className="cursor-pointer type-mono-sm uppercase tracking-widest text-slate-500 hover:text-slate-300">
        Recent alerts
      </summary>
      {failed ? (
        <p className="mt-2 type-caption text-slate-500">Couldn&apos;t load alert history.</p>
      ) : events === null ? (
        <p className="mt-2 type-caption text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="mt-2 type-caption text-slate-500">No alerts raised yet.</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className="type-note leading-snug">
              <span aria-hidden className="mr-1">{KIND_EMOJI[e.kind] ?? "•"}</span>
              <span className="text-slate-300">{e.title}</span>
              <span className="ml-1 font-mono text-slate-600">
                {e.createdAt.slice(0, 10)} ·{" "}
                {e.delivered ? (
                  <span className="text-emerald-400/80">delivered</span>
                ) : (
                  <span className="text-slate-500">{OUTCOME[e.suppressedReason ?? ""] ?? "not sent"}</span>
                )}
              </span>
              {canResend && e.resendable && <ResendAction e={e} state={resends[e.id]} onResend={onResend} />}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
