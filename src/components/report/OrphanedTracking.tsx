"use client";

// "The last re-scan couldn't carry these." — Direction 3.
//
// matchRecommendations refuses to guess when two gaps in one dimension were both reworded between
// scans. That refusal is right; what was wrong is that scans-persist then wrote the new rows at
// open/unassigned and the user's own status, assignee and due date disappeared with NO error. The
// engine's honest refusal was indistinguishable from data loss.
//
// This panel is the visibility half: it names how many tracked items could not be carried and which
// ones, and offers a re-link — the user picks the item in THIS scan that is the same gap, and the old
// planning state is applied to it through the ordinary PATCH. No guessing is added to the matcher;
// the human resolves exactly the ambiguity the matcher declined to.

import { useEffect, useState } from "react";
import type { PersistedRecommendation, RecStatus } from "@/lib/types";
import type { OrphanedTrackedRec } from "@/lib/db/scans-recommendations";
import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { Surface } from "@/components/ui";

/** The tracking an orphan carries, as one human line. */
function trackingSummary(o: OrphanedTrackedRec): string {
  const bits = [STATUS_LABEL[o.status as RecStatus] ?? o.status];
  if (o.assigneeLogin) bits.push(`@${o.assigneeLogin}`);
  if (o.targetDate) bits.push(`due ${o.targetDate}`);
  return bits.join(" · ");
}

export function OrphanedTracking({
  repoRef,
  items,
  onApplied,
}: {
  repoRef: string;
  /** The current scan's recommendations — the re-link targets. */
  items: PersistedRecommendation[];
  onApplied: (rec: PersistedRecommendation) => void;
}) {
  const [orphans, setOrphans] = useState<OrphanedTrackedRec[] | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Best-effort by design: this panel is an ADDITION to the tracker. A failed load must leave the
    // roadmap fully usable, so it degrades to rendering nothing rather than to an error state.
    fetch(`/api/recommendations/orphans?repo=${encodeURIComponent(repoRef)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: OrphanedTrackedRec[] } | null) => {
        if (live) setOrphans(data?.items ?? []);
      })
      .catch(() => {
        if (live) setOrphans([]);
      });
    return () => {
      live = false;
    };
  }, [repoRef]);

  if (!orphans || orphans.length === 0) return null;

  /** Key an orphan by its own identity — it has no row id in THIS scan, by definition. */
  const keyOf = (o: OrphanedTrackedRec) => `${o.dim}::${o.title}`;

  async function relink(o: OrphanedTrackedRec) {
    const key = keyOf(o);
    const targetId = targets[key];
    if (!targetId) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/recommendations/${targetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: o.status,
          assigneeLogin: o.assigneeLogin,
          targetDate: o.targetDate,
          // The note makes the re-link auditable on the target's own timeline — otherwise the state
          // would appear from nowhere.
          note: `Re-linked tracking from the previous scan's “${o.title}”.`,
        }),
      });
      if (!res.ok) {
        setError("Couldn’t re-link that item. Check your connection and try again.");
        return;
      }
      const saved = (await res.json().catch(() => null)) as PersistedRecommendation | null;
      if (saved) onApplied(saved);
      // Drop it locally too: the server-side derivation self-heals on the next read (the target now
      // carries this exact tracking), but the panel shouldn't wait for a reload to say so.
      setOrphans((cur) => (cur ?? []).filter((x) => keyOf(x) !== key));
    } catch {
      setError("Couldn’t re-link that item. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Surface radius="xl" className="border-amber-500/30 bg-amber-500/5 p-4">
      <h3 className="text-base font-semibold text-amber-100">
        {orphans.length} tracked item{orphans.length === 1 ? "" : "s"} couldn’t be carried into this scan
      </h3>
      <p className="mt-1 text-sm text-amber-200/80">
        The gap{orphans.length === 1 ? " was" : "s were"} reworded between scans and more than one item
        in the same dimension changed, so pairing them would have been a guess. Nothing was lost — pick
        the item below that is the same gap and the tracking moves across.
      </p>

      <ul className="mt-3 space-y-3">
        {orphans.map((o) => {
          const key = keyOf(o);
          const candidates = items.filter((i) => i.dimension === o.dim);
          return (
            <li key={key} className="rounded-lg border border-amber-500/20 bg-slate-950/30 p-3">
              <p className="text-sm font-medium text-slate-100">{o.title}</p>
              <p className="mt-0.5 font-mono text-sm text-amber-200/70">
                {o.dim} · {trackingSummary(o)}
              </p>
              {candidates.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">
                  This scan raised nothing in {o.dim} — the gap may simply be closed.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`relink-${key}`}>
                    Re-link “{o.title}” to
                  </label>
                  <select
                    id={`relink-${key}`}
                    value={targets[key] ?? ""}
                    onChange={(e) => setTargets((t) => ({ ...t, [key]: e.target.value }))}
                    className="max-w-full flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200"
                  >
                    <option value="">Same gap in this scan…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!targets[key] || busy === key}
                    onClick={() => relink(o)}
                    className="rounded-md border border-amber-500/40 px-2 py-1 text-sm font-medium text-amber-200 transition hover:bg-amber-500/10 disabled:opacity-40"
                  >
                    {busy === key ? "Re-linking…" : "Re-link"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-200/90">
          {error}
        </p>
      )}
    </Surface>
  );
}
