"use client";

import { useState } from "react";
import type { PersistedRecommendation, RecStatus, ScanReport } from "@/lib/types";
import { ExploreList, PayoffChip, RoadmapMeta } from "@/components/report/roadmapPieces";
import { applyOptimisticStatus, rollbackRowStatus } from "@/components/report/recommendationRowState";
import { STATUS_LABEL, STATUS_ACCENT } from "@/components/org/backlogShared";
import { Surface } from "@/components/ui";

/** A per-row save failure: the change the user attempted, and whether it's recoverable. */
interface RowError {
  /** The status change that failed — re-applied by the Retry button. */
  status: RecStatus;
  /** "config" = persistence not available (503, retry won't help); "transient" = retryable. */
  kind: "config" | "transient";
  message: string;
}

/** Small busy indicator for the row currently saving (frozen, not spinning, under reduced motion). */
function RowSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-accent motion-reduce:animate-none"
    />
  );
}

export function RecommendationTracker({
  items: initial,
  report,
}: {
  items: PersistedRecommendation[];
  report: ScanReport;
}) {
  const [items, setItems] = useState(initial);
  // Per-id saving set (not a single shared string) so overlapping in-flight PATCHes each
  // disable only their own row instead of one freezing/clobbering another.
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [announcement, setAnnouncement] = useState("");

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Repo ref for the concurrent-edit (409) refetch below — re-seeds a row from the server before Retry.
  const repoRef = `${report.repo.owner}/${report.repo.name}`;

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const dismissed = items.filter((i) => i.status === "dismissed").length;
  // Dismissed items are intentionally OUT of scope, so they must leave the denominator — otherwise
  // dismissing N of M caps the progress ring below 100% forever (e.g. 4 dismissed of 10 → max 60%
  // even after every actionable item is done). Base the percentage on the actionable set.
  const actionable = total - dismissed;
  const pct = actionable > 0 ? Math.round((done / actionable) * 100) : 100;

  function clearError(id: string) {
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  /** After a concurrent-edit 409, pull this row's current server value and re-seed it locally so the
   *  displayed status — and the Retry — rebase on the latest state instead of the user's stale
   *  pre-image (which would just conflict again). Best-effort: on failure the error + Retry remain. */
  async function refreshRow(id: string) {
    try {
      const res = await fetch(`/api/recommendations?repo=${encodeURIComponent(repoRef)}`);
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { items?: PersistedRecommendation[] } | null;
      const fresh = data?.items?.find((i) => i.id === id);
      if (fresh?.status) setItems((cur) => applyOptimisticStatus(cur, id, fresh.status));
    } catch {
      // Network error while refreshing — leave the rolled-back row as-is; the transient error offers Retry.
    }
  }

  async function setStatus(id: string, status: RecStatus) {
    const row = items.find((i) => i.id === id);
    const title = row?.title ?? "Recommendation";
    // Capture ONLY this row's prior status for a targeted rollback. Reverting to a whole-list
    // snapshot (the old `setItems(prev)`) would clobber other rows' concurrent optimistic or
    // already-confirmed changes when several updates overlap.
    const priorStatus = row?.status;
    const rollback = () => setItems((cur) => rollbackRowStatus(cur, id, priorStatus));

    setSaving(id, true);
    clearError(id);
    setItems((cur) => applyOptimisticStatus(cur, id, status)); // optimistic, this row only
    try {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // Distinguish "tracking simply isn't available" (503 — no DB) from a transient failure,
        // so the message is honest and only retryable errors offer a Retry.
        const kind: RowError["kind"] = res.status === 503 ? "config" : "transient";
        const message =
          kind === "config"
            ? "Progress tracking isn’t available here — it needs a connected database, so this change can’t be saved."
            : res.status === 409
              ? "This recommendation changed elsewhere — showing the latest. Retry to reapply your change."
              : "Couldn’t save that change. Check your connection and retry.";
        rollback(); // revert ONLY this row
        // A 409 means a concurrent edit landed since this row loaded; pull the current server value and
        // re-seed the row so the display (and a Retry) rebase on the latest, instead of resubmitting the
        // same stale change that just conflicts again.
        if (res.status === 409) await refreshRow(id);
        setErrors((e) => ({ ...e, [id]: { status, kind, message } }));
        setAnnouncement(`Couldn’t update “${title}”: ${message}`);
        return;
      }
      // Reconcile from the authoritative server row so the displayed status + the done/total count
      // track what was actually stored (a server normalization or a concurrent change), not just what
      // we optimistically sent. Was: keep the optimistic value + discard the response.
      const saved = (await res.json().catch(() => null)) as PersistedRecommendation | null;
      if (saved?.status) setItems((cur) => applyOptimisticStatus(cur, id, saved.status));
      setAnnouncement(`“${title}” marked ${STATUS_LABEL[status]}.`);
    } catch {
      rollback();
      setErrors((e) => ({
        ...e,
        [id]: { status, kind: "transient", message: "Couldn’t save that change. Check your connection and retry." },
      }));
      setAnnouncement(`Couldn’t update “${title}”: network error.`);
    } finally {
      setSaving(id, false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Polite live region — announces every save success/failure for screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <Surface radius="xl" className="p-4">
        <div className="flex items-center justify-between text-base">
          <span className="font-medium text-white">
            {done} of {total} done
            {dismissed > 0 && <span className="text-slate-500"> · {dismissed} dismissed</span>}
          </span>
          <span className="text-slate-400">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Surface>

      {items.map((item) => {
        const muted = item.status === "done" || item.status === "dismissed";
        const err = errors[item.id];
        const saving = savingIds.has(item.id);
        const edge = err ? (err.kind === "config" ? "#eab308" : "#ef4444") : STATUS_ACCENT[item.status];
        return (
          <div
            key={item.id}
            aria-busy={saving}
            className="rounded-xl border bg-surface/40 p-5"
            style={{ borderLeftWidth: 3, borderLeftColor: edge }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={`font-semibold ${muted ? "text-slate-400 line-through decoration-slate-600" : "text-white"}`}>
                {item.title}
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <RoadmapMeta item={item} />
                <PayoffChip report={report} dim={item.dimension} />
                {saving && <RowSpinner />}
                <select
                  value={item.status}
                  disabled={saving}
                  onChange={(e) => setStatus(item.id, e.target.value as RecStatus)}
                  aria-label="Recommendation status"
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
                  style={{ color: STATUS_ACCENT[item.status] }}
                >
                  {(Object.keys(STATUS_LABEL) as RecStatus[]).map((s) => (
                    <option key={s} value={s} className="text-slate-200">
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {item.rationale && <p className="mt-2 text-base leading-relaxed text-slate-400">{item.rationale}</p>}
            {!muted && <ExploreList items={item.explore} />}
            {err && (
              <div
                role="alert"
                className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  err.kind === "config"
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-200/90"
                    : "border-red-500/30 bg-red-500/5 text-red-200/90"
                }`}
              >
                <span aria-hidden>{err.kind === "config" ? "ⓘ" : "⚠"}</span>
                <span className="flex-1">{err.message}</span>
                {err.kind === "transient" && (
                  <button
                    type="button"
                    onClick={() => setStatus(item.id, err.status)}
                    disabled={saving}
                    className="rounded-md border border-red-500/40 px-2 py-0.5 font-medium text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
                {err.kind === "config" && (
                  <button
                    type="button"
                    onClick={() => clearError(item.id)}
                    className="rounded-md border border-amber-500/40 px-2 py-0.5 font-medium text-amber-200 transition hover:bg-amber-500/10"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
