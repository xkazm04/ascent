"use client";

import { useCallback, useState } from "react";
import { REC_STATUSES, type RecStatus } from "@/lib/types";
import { STATUS_ACCENT, STATUS_LABEL } from "@/components/org/backlogShared";

/**
 * Per-id saving + error bookkeeping shared by the two recommendation-status editors — the per-repo
 * report's RecommendationTracker and the org BacklogPanel. Tracks WHICH ids are mid-PATCH in a Set
 * (so overlapping in-flight saves each disable only their own row instead of one freezing/clobbering
 * another), plus a per-id error map cleared on the next edit. Generic over the error shape: a plain
 * message string in the backlog, a structured RowError in the tracker.
 */
export function useSavingIds<E = string>() {
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, E>>({});

  const setSaving = useCallback((id: string, on: boolean) => {
    setSavingIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const setError = useCallback((id: string, error: E) => {
    setErrors((e) => ({ ...e, [id]: error }));
  }, []);

  const clearError = useCallback((id: string) => {
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }, []);

  return { savingIds, errors, setSaving, setError, clearError };
}

/**
 * The recommendation-status dropdown — single-sourced from both status editors. Byte-identical
 * markup: the same classes + STATUS_ACCENT color, options mapped over the canonical status list with
 * STATUS_LABEL captions. The option list is parameterized (defaults to REC_STATUSES, whose order
 * matches STATUS_LABEL's keys 1:1); only the aria-label varies per caller ("Status" in the backlog
 * row vs "Recommendation status" in the report tracker).
 */
export function StatusSelect({
  value,
  disabled,
  onChange,
  "aria-label": ariaLabel,
  statuses = REC_STATUSES,
}: {
  value: RecStatus;
  disabled: boolean;
  onChange: (status: RecStatus) => void;
  "aria-label": string;
  statuses?: RecStatus[];
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as RecStatus)}
      aria-label={ariaLabel}
      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
      style={{ color: STATUS_ACCENT[value] }}
    >
      {statuses.map((s) => (
        <option key={s} value={s} className="text-slate-200">
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
