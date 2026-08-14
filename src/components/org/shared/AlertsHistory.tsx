"use client";

// The alerts popover's "Recent alerts" section — the persisted AlertEvent history that closes the
// fire-and-forget gap: every alert the product decided to raise is listed with its delivery outcome,
// including alerts raised when NO sink was configured (before this table, those vanished without a
// trace). Member-readable (GET /api/org/alerts?history=1 — rows carry titles and outcomes, never the
// sink URL). Collapsed behind a <details> so the popover's primary jobs (movement, routing config)
// keep the space. Lazy: fetches once on first expand.

import { useState } from "react";

interface AlertEventRow {
  id: string;
  kind: string;
  severity: string;
  repoFullName: string | null;
  title: string;
  delivered: boolean;
  suppressedReason: string | null;
  createdAt: string;
}

const KIND_EMOJI: Record<string, string> = {
  regression: "🔻",
  promotion: "🎉",
  security: "🛡️",
  "low-credits": "🪫",
  digest: "🗞️",
  "goal-at-risk": "🎯",
  "spend-anomaly": "💸",
};

const OUTCOME: Record<string, string> = {
  "no-sink": "not sent (no sink)",
  cooldown: "suppressed (cooldown)",
  "dispatch-failed": "delivery failed",
};

export function AlertsHistory({ org }: { org: string }) {
  const [events, setEvents] = useState<AlertEventRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    if (events !== null || failed) return;
    try {
      const res = await fetch(`/api/org/alerts?org=${encodeURIComponent(org)}&history=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      setEvents((data.events as AlertEventRow[]) ?? []);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details className="mb-3 border-b border-slate-800 pb-3" onToggle={(e) => e.currentTarget.open && void load()}>
      <summary className="cursor-pointer font-mono text-sm uppercase tracking-widest text-slate-500 hover:text-slate-300">
        Recent alerts
      </summary>
      {failed ? (
        <p className="mt-2 font-mono text-xs text-slate-500">Couldn&apos;t load alert history.</p>
      ) : events === null ? (
        <p className="mt-2 font-mono text-xs text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="mt-2 font-mono text-xs text-slate-500">No alerts raised yet.</p>
      ) : (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className="text-xs leading-snug">
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
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
