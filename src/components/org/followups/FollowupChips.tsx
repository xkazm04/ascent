"use client";

// The ledger's row vocabulary, shared by every variant: impact/effort chips, the status pill, the
// projected-points figure, and the two per-row feedback actions (resolve / dismiss) that let a user
// close a row by hand when the scan can't see the fix.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EFFORT_CLASS, IMPACT_CLASS, timeAgo } from "@/lib/ui";
import { STATUS_LABEL, claimLine, type FollowUpRow, type FollowUpStatus } from "./followupsModel";

/**
 * NEEDS HUMAN (moonshot #3) — an agent tried this row and stopped deliberately.
 *
 * A chip and not a status, which is the whole distinction: the row is still `in_progress` and still
 * owed, and a fifth status would have hidden it from every "what is open" count in the product. It
 * sits beside the status pill rather than replacing it, and it is the ONE row state on this ledger
 * that a machine can raise and only a person can clear.
 */
export function NeedsHumanChip({ r }: { r: Pick<FollowUpRow, "needsHuman"> }) {
  if (!r.needsHuman) return null;
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full border border-warn/60 px-2 py-px type-caption text-warn"
      title="An agent worked this and stopped deliberately — it needs a person. The row is still open."
    >
      needs human
    </span>
  );
}

/** Who holds this row and for how long. Renders nothing when nobody does — the ordinary open row. */
export function ClaimLine({ r }: { r: Pick<FollowUpRow, "claimActor" | "leaseUntil" | "status"> }) {
  const line = claimLine(r);
  if (!line) return null;
  return (
    <span className="whitespace-nowrap type-caption tabular-nums text-slate-500" title="A work lease. When it expires the row returns to the queue.">
      {line}
    </span>
  );
}

export function ImpactEffort({ r }: { r: Pick<FollowUpRow, "impact" | "effort"> }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap type-caption">
      <span className={`rounded border px-1 py-px ${IMPACT_CLASS[r.impact] ?? "border-slate-700 text-slate-400"}`} title={`impact ${r.impact}`}>
        {r.impact[0]?.toUpperCase()}
      </span>
      <span className={`rounded border px-1 py-px ${EFFORT_CLASS[r.effort] ?? "border-slate-700 text-slate-400"}`} title={`effort ${r.effort}`}>
        {r.effort[0]?.toUpperCase()}
      </span>
    </span>
  );
}

const STATUS_CLASS: Record<FollowUpStatus, string> = {
  open: "border-divider text-slate-400",
  in_progress: "border-accent/60 text-accent",
  done: "border-emerald-500/50 text-emerald-400",
  dismissed: "border-slate-700 text-slate-500 line-through",
};

export function StatusPill({ status, at }: { status: FollowUpStatus; at?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px type-caption ${STATUS_CLASS[status]}`} title={at ? `last activity ${timeAgo(at)}` : undefined}>
      {status === "in_progress" && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Points({ n }: { n: number | null }) {
  if (n == null) return <span className="type-caption text-slate-600">—</span>;
  return (
    <span className="type-mono-sm tabular-nums text-slate-200" title="Overall-score points the repo gains if this gap fully closes">
      +{n}
    </span>
  );
}

/** Close a row by hand — the human half of the feedback loop, for fixes a scan can't see. */
export function RowActions({ r, compact = false }: { r: FollowUpRow; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const set = async (status: FollowUpStatus) => {
    setBusy(status);
    try {
      await fetch(`/api/recommendations/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };
  if (r.status === "done" || r.status === "dismissed") {
    return (
      <button type="button" onClick={() => set("open")} disabled={busy !== null} className="focus-ring rounded type-caption text-slate-500 hover:text-accent">
        reopen
      </button>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2 type-caption ${compact ? "" : "gap-3"}`}>
      <button type="button" onClick={() => set("done")} disabled={busy !== null} className="focus-ring rounded text-slate-500 hover:text-emerald-400" title="Mark resolved by hand">
        {busy === "done" ? "…" : "resolve"}
      </button>
      <button type="button" onClick={() => set("dismissed")} disabled={busy !== null} className="focus-ring rounded text-slate-500 hover:text-slate-300" title="Not applicable here">
        {busy === "dismissed" ? "…" : "dismiss"}
      </button>
    </span>
  );
}
