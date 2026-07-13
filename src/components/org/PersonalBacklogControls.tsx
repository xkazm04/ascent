"use client";

// Client controls for one personal-backlog item: the status select and the due-date input. Both
// post the viewer's OVERLAY to /api/me/backlog (shared recommendations are never mutated) and
// refresh the server-rendered list. Optimistic-free by design — the list is small and the write is
// fast, so a disabled control during flight is honest and simpler than rollback bookkeeping.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { REC_STATUSES, type RecStatus } from "@/lib/types";

export interface OverlayKey {
  repo: string;
  dimId: string;
  title: string;
}

async function postOverlay(key: OverlayKey, patch: { status?: RecStatus; targetDate?: string | null }): Promise<string | null> {
  try {
    const res = await fetch("/api/me/backlog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...key, ...patch }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? "Something went wrong. Try again.";
  } catch {
    return "Network error. Try again.";
  }
}

export function OverlayStatusSelect({ item, status }: { item: OverlayKey; status: RecStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    if (busy || next === status) return;
    setBusy(true);
    setError(null);
    const err = await postOverlay(item, { status: next as RecStatus });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={status}
        onChange={(e) => change(e.target.value)}
        disabled={busy}
        aria-label={`Status of "${item.title}" on ${item.repo}`}
        className="focus-ring rounded-md border border-slate-700 bg-ink px-2 py-1 font-mono text-sm text-slate-300 disabled:opacity-50"
      >
        {REC_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-sm text-rose-400">
          {error}
        </span>
      )}
    </span>
  );
}

export function OverlayDueDate({ item, targetDate }: { item: OverlayKey; targetDate: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    if (busy) return;
    setBusy(true);
    // An emptied input clears the personal due date (explicit null, not "untouched").
    await postOverlay(item, { targetDate: value === "" ? null : value });
    setBusy(false);
    router.refresh();
  }

  return (
    <input
      type="date"
      defaultValue={targetDate ?? ""}
      onChange={(e) => change(e.target.value)}
      disabled={busy}
      aria-label={`Personal due date for "${item.title}" on ${item.repo}`}
      className="focus-ring rounded-md border border-slate-700 bg-ink px-2 py-1 font-mono text-sm text-slate-400 disabled:opacity-50"
    />
  );
}
