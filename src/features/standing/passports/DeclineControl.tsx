"use client";

// THE WRITER for "declined by choice" — the half of passport 0.4.0 that had no UI.
//
// The whole decline machinery already existed and was unreachable: the allow-list (DECLINABLE_PATHS),
// the PATCH route, the 365-day re-confirmation, the severity-drift re-surfacing, and three read
// surfaces that rendered declines nobody could create. Only identity fields (criticality/lifecycle/
// rollback) had a control. So an owner who had ACCEPTED a trade-off — "no error tracking, this is an
// internal cron worker" — could not record it, and the blocker re-litigated itself on every scan,
// which is precisely what the overlay exists to prevent.
//
// One component, two directions, because they are one decision: `decline` records the acceptance from
// the open blocker row, `retract` takes it back from the Accepted-by-choice list. Both are a merge
// PATCH on ONE field path, so neither can disturb the rest of the overrides blob.
//
// WHAT ELSE THE ENTRY CARRIES. The reason is optional; `at`, `code` and `severity` are not, whenever
// we know them. They are the BASELINE the overlay compares against later — without them a decline can
// never age out and can never re-surface when the gap hardens, which quietly turns a 365-day
// re-confirmation window into "forever" for every decline this control creates. The route sanitizes
// all four (trims/caps the reason, drops a malformed date), so this sends the honest values it has.
//
// OWNER GATE: the drawer does not know the viewer's role — the passports tab resolves no membership —
// so the control renders for everyone and the route's 403 lands in the inline error. Hiding it would
// need a role the server page does not currently read.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TextInput } from "@/components/ui";
import { DECLINE_REASON_MAX } from "@/lib/analyze/passport-overlay";
import type { FindingSeverity } from "@/lib/types";

// Same skin as DecisionControl, which sits beside this on every blocker row: one control voice per row.
const BTN = "focus-ring rounded-md border px-2.5 py-1 type-caption transition disabled:opacity-50";
const IDLE = "border-divider text-slate-400 hover:border-accent hover:text-white";

/** Today as YYYY-MM-DD — the day the choice was made, which is the only clock reading in the flow.
 *  The overlay itself stays pure and measures age against the passport's `generatedAt`. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DeclineControl({
  repo,
  path,
  mode,
  code,
  severity,
}: {
  /** `owner/name` — the route's `repo`. */
  repo: string;
  /** An allow-listed passport field path. Callers get it from `declinablePathForFinding`, never by
   *  hand: the allow-list must have exactly one copy or the UI offers declines the route rejects. */
  path: string;
  mode: "decline" | "retract";
  /** The finding's cause code / severity AS IT STANDS NOW — the baseline a later scan compares to. */
  code?: string;
  severity?: FindingSeverity;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [reason, setReason] = useState("");
  const working = busy || pending;

  /** Merge one entry (or `null` to retract it) at this path. Same fetch/error shape as
   *  PassportOwnerControls + DecisionControl: read the body's `error`, refresh, never alert(). */
  async function patch(entry: Record<string, string> | null) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/report/passport/overrides", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo, declined: { [path]: entry } }),
    }).catch(() => null);

    setBusy(false);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? "Couldn't record that. Try again.");
      return;
    }
    setDrafting(false);
    setReason("");
    // Re-read the server so the blocker moves under "Accepted by choice" without a page reload — the
    // overlay is applied read-time, so a refresh is the whole update.
    startTransition(() => router.refresh());
  }

  if (mode === "retract") {
    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <button type="button" disabled={working} onClick={() => patch(null)} className={`${BTN} ${IDLE}`}>
          Retract
        </button>
        {error && <span className="type-note text-danger">{error}</span>}
      </span>
    );
  }

  if (drafting) {
    const trimmed = reason.trim();
    return (
      <div className="flex w-full flex-col gap-2">
        <label className="sr-only" htmlFor={`decline-why-${path}`}>
          Why is this gap acceptable here?
        </label>
        <TextInput
          id={`decline-why-${path}`}
          value={reason}
          autoFocus
          maxLength={DECLINE_REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this trade-off acceptable here? (optional — agents and the next reader see it)"
          className="type-body-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={working}
            onClick={() =>
              patch({
                ...(trimmed ? { reason: trimmed } : {}),
                at: today(),
                ...(code ? { code } : {}),
                ...(severity ? { severity } : {}),
              })
            }
            className={`${BTN} border-accent/60 text-white hover:bg-accent/10`}
          >
            Record decision
          </button>
          <button type="button" disabled={working} onClick={() => setDrafting(false)} className={`${BTN} ${IDLE}`}>
            Cancel
          </button>
          <span className="type-note text-slate-600">
            A decline never moves a score — it records the judgment, and is re-asked in a year.
          </span>
          {error && <span className="type-note text-danger">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={working}
        onClick={() => setDrafting(true)}
        className={`${BTN} ${IDLE}`}
        title="Record that this gap is a deliberate trade-off for this repo"
      >
        Decline by choice
      </button>
      {error && <span className="type-note text-danger">{error}</span>}
    </span>
  );
}
