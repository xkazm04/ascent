"use client";

// ONE DIRECTION — a fenced, budgeted grant an approved plan created: its fence, how much of its budget
// is spent, the plans that ran under it, who approved it and when; and, for an owner, Revoke (withdraw
// the grant — its approved-but-unexecuted plans return to the inbox) or Mark done (close it — those
// plans are superseded). Only an active or exhausted direction can be ended; the server says so on a race.

import { useState } from "react";
import { Meter } from "@/components/org/shared/ui";
import { fmtAgo, fmtUsd, shortRepo } from "./ledgerFormat";
import { settleDirection } from "./ledgerClient";
import type { LoopDirectionRecord, LoopPlanRecord } from "./ledgerTypes";

const STATUS_TONE: Record<string, string> = {
  active: "text-success-soft",
  exhausted: "text-warn",
  done: "text-slate-400",
  revoked: "text-slate-500",
};

export function DirectionRow({
  d,
  plans,
  now,
  isOwner,
  onSettled,
}: {
  d: LoopDirectionRecord;
  plans: readonly LoopPlanRecord[];
  now: string;
  isOwner: boolean;
  onSettled: (d: LoopDirectionRecord, action: "revoke" | "done") => void;
}) {
  const [busy, setBusy] = useState<"revoke" | "done" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endable = d.status === "active" || d.status === "exhausted";
  const act = async (action: "revoke" | "done") => {
    setBusy(action);
    setError(null);
    try {
      onSettled(await settleDirection(d.id, action), action);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that direction.");
    } finally {
      setBusy(null);
    }
  };
  const cyclePct = d.budgetCycles > 0 ? (d.usedCycles / d.budgetCycles) * 100 : 0;

  return (
    <li id={`direction-${d.id}`} data-testid="direction" className="scroll-mt-24 space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 type-body text-slate-100">
          {d.title}
          <span className="type-caption text-slate-500"> · {shortRepo(d.repo)}</span>
        </p>
        <span className={`type-label tracking-[0.2em] ${STATUS_TONE[d.status] ?? "text-slate-400"}`}>{d.status}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Fence">
        {d.fence.map((m) => (
          <li key={m} className="rounded-md border border-divider px-2 py-0.5 font-mono type-caption text-slate-300">
            {m}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="type-caption tabular-nums text-slate-400">
            {d.usedCycles}/{d.budgetCycles} cycles
          </p>
          <Meter value={cyclePct} size="sm" ariaLabel={`${d.usedCycles} of ${d.budgetCycles} cycles used`} />
        </div>
        {d.budgetMicros != null && (
          <div>
            <p className="type-caption tabular-nums text-slate-400">
              {fmtUsd(d.usedMicros)} of {fmtUsd(d.budgetMicros)}
            </p>
            <Meter value={d.budgetMicros > 0 ? (d.usedMicros / d.budgetMicros) * 100 : 0} size="sm" ariaLabel="Spend against the direction's budget" />
          </div>
        )}
      </div>
      <p className="type-caption text-slate-500">
        Approved {d.approvedBy ? `by ${d.approvedBy} ` : ""}
        {fmtAgo(d.approvedAt, now)} · check: {d.checkText || "none named"}
      </p>
      {plans.length > 0 && (
        <ul data-testid="direction-plans" className="space-y-0.5 type-caption text-slate-400">
          {plans.map((p) => (
            <li key={p.id}>
              <span className="text-slate-500">{p.status}</span> · {p.itemTitles[0] ?? p.plan?.intent ?? p.id}
              {p.itemTitles.length > 1 ? ` +${p.itemTitles.length - 1}` : ""}
            </li>
          ))}
        </ul>
      )}
      {endable && isOwner && (
        <div className="flex gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void act("done")} className="focus-ring rounded-lg border border-divider px-3 py-1 type-caption text-slate-200 hover:border-accent disabled:opacity-50">
            {busy === "done" ? "Closing…" : "Mark done"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void act("revoke")} className="focus-ring rounded-lg border border-danger/50 px-3 py-1 type-caption text-danger hover:bg-danger/10 disabled:opacity-50">
            {busy === "revoke" ? "Revoking…" : "Revoke"}
          </button>
        </div>
      )}
      {endable && !isOwner && <p className="type-caption text-slate-500">An owner can revoke or close this direction.</p>}
      {error && (
        <p role="alert" className="type-caption text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
