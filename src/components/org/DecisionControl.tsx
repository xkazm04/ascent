"use client";

// The decision affordance on a derived finding — the control that turns a read-only signal into
// something you can close. Accept ("we'll do this"), Dismiss ("not a problem here") and Snooze ("not
// now") all resolve the finding and drop it out of the org rail's badge; Reopen puts it back.
//
// The rationale is the point. A dismissed finding with no reason teaches nobody anything, so the
// rationale rides the decision into Shared Org Memory where connected agents and the next scan prompt
// read it. Dismiss therefore REQUIRES a rationale — accept doesn't, because "yes, we'll fix it" is
// self-explanatory while "no, ignore this" is exactly the judgment a future reader needs explained.
//
// Optimistic: the row greys out the instant you decide, then router.refresh() re-reads the server so
// the rail badge and the page agree. A failed write restores the previous state and surfaces the error.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FindingModule } from "@/lib/org/findings";

export type DecisionStatusUi = "open" | "accepted" | "dismissed" | "snoozed";

const RESOLVED_LABEL: Record<Exclude<DecisionStatusUi, "open">, string> = {
  accepted: "Accepted",
  dismissed: "Dismissed",
  snoozed: "Snoozed",
};

const TONE: Record<Exclude<DecisionStatusUi, "open">, string> = {
  accepted: "border-emerald-500/40 text-emerald-300",
  dismissed: "border-slate-500/40 text-slate-300",
  snoozed: "border-amber-500/40 text-amber-300",
};

/** 30 days out — the snooze horizon. Long enough to mean "next quarter's problem", short enough to return. */
function snoozeDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

const BTN = "focus-ring rounded-md border px-2.5 py-1 font-mono text-xs transition disabled:opacity-50";
const IDLE = "border-divider text-slate-400 hover:border-accent hover:text-white";

export function DecisionControl({
  org,
  module,
  itemKey,
  title,
  status,
  rationale,
  decidedBy,
}: {
  org: string;
  module: FindingModule;
  itemKey: string;
  title: string;
  /** The decision already on record, or "open" when nobody has judged this finding. */
  status: DecisionStatusUi;
  rationale?: string;
  decidedBy?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [why, setWhy] = useState("");

  async function send(next: DecisionStatusUi, reason: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/org/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org,
        module,
        itemKey,
        title,
        status: next,
        rationale: reason,
        ...(next === "snoozed" ? { snoozedUntil: snoozeDate() } : {}),
      }),
    }).catch(() => null);

    setBusy(false);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? "Couldn't record that. Try again.");
      return;
    }
    setDrafting(false);
    setWhy("");
    // Re-read the server so this row, the page's counts and the rail badge all move together.
    startTransition(() => router.refresh());
  }

  const working = busy || pending;

  if (status !== "open") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-xs ${TONE[status]}`}>
          {RESOLVED_LABEL[status]}
          {decidedBy ? ` · ${decidedBy}` : ""}
        </span>
        {rationale && <span className="min-w-0 truncate text-xs text-slate-500">{rationale}</span>}
        <button type="button" disabled={working} onClick={() => send("open", "")} className={`${BTN} ${IDLE}`}>
          Reopen
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  if (drafting) {
    return (
      <div className="flex flex-col gap-2">
        <label className="sr-only" htmlFor={`why-${itemKey}`}>
          Why are you dismissing this?
        </label>
        <input
          id={`why-${itemKey}`}
          value={why}
          autoFocus
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Why is this not a problem here? (agents will read this)"
          className="focus-ring w-full rounded-md border border-divider bg-ink px-2.5 py-1.5 text-sm text-white placeholder:text-slate-600"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={working || !why.trim()}
            onClick={() => send("dismissed", why)}
            className={`${BTN} border-accent/60 text-white hover:bg-accent/10`}
          >
            Dismiss
          </button>
          <button type="button" disabled={working} onClick={() => setDrafting(false)} className={`${BTN} ${IDLE}`}>
            Cancel
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={working} onClick={() => send("accepted", why)} className={`${BTN} ${IDLE}`}>
        Accept
      </button>
      <button type="button" disabled={working} onClick={() => setDrafting(true)} className={`${BTN} ${IDLE}`}>
        Dismiss
      </button>
      <button type="button" disabled={working} onClick={() => send("snoozed", "Snoozed for 30 days")} className={`${BTN} ${IDLE}`}>
        Snooze 30d
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
