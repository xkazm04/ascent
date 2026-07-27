"use client";

// The FLEET ROLLOUT half of the practice apply action — extracted verbatim from PracticeApply so that
// file stays under the 300-LOC cap (AGENTS.md) once per-repo PR state landed. It owns its own batch
// state (selection, confirm, results) and reports only its busy flag upward, because the single-repo
// apply and the batch are mutually locked (practices #5) — neither may fire while the other is in
// flight. No behavior change beyond the open-PR awareness described on `openPrs`.

import { useState } from "react";
import { ConfirmAction, batchPrConfirm } from "@/components/ConfirmAction";
import { MAX_BATCH, type BatchResult, type OpenPrRef, type RepoRef } from "./practice-apply-shared";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";

export function PracticeApplyBatch({
  practiceId,
  gapRepos,
  openPrs,
  singleBusy,
  onBusyChange,
}: {
  practiceId: string;
  gapRepos: RepoRef[];
  /** Repos that already have a live starter PR for this practice — never offered a duplicate. */
  openPrs: Map<string, OpenPrRef>;
  /** A single-repo preview/apply is in flight — the batch stays locked. */
  singleBusy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [showBatch, setShowBatch] = useState(false);
  // Default selection excludes repos already in flight: re-applying there would only re-surface the
  // same `ascent/<practice>` branch, so the confirm's "open N PRs" count would overstate the action.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(gapRepos.filter((r) => !openPrs.has(r.fullName)).map((r) => r.fullName)),
  );
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ attempted: number; skipped: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  // The batch is the most expensive button in the app — one click opens a real draft PR in up to
  // MAX_BATCH repos at once. Gate it behind a confirm that states the count + the org before firing.
  const [confirmingBatch, setConfirmingBatch] = useState(false);

  const selectable = gapRepos.filter((r) => !openPrs.has(r.fullName));
  // All gap repos belong to one org (the batch route rejects a mixed-owner batch); take the owner from
  // the first so the confirm can name the org whose repos are about to receive PRs.
  const batchOrg = gapRepos[0]?.fullName.split("/")[0] ?? "the org";

  function setBusy(b: boolean) {
    setBatchBusy(b);
    onBusyChange(b);
  }

  function toggleSelected(fullName: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function applyBatch() {
    // gapRepos is ordered highest-score-first (least needy), so the repos most in need of remediation
    // are LAST. The server keeps the first MAX_BATCH repos it receives when truncating, so send the
    // neediest first — otherwise the cap would silently drop exactly the repos the rollout should fix.
    const repos = selectable
      .filter((r) => selected.has(r.fullName))
      .map((r) => r.fullName)
      .reverse();
    if (repos.length === 0) return;
    setBusy(true);
    setBatchError(null);
    setBatchResults(null);
    setBatchSummary(null);
    try {
      const res = await fetch("/api/practices/apply-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repos, practiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PRs.");
      const results = data.results as BatchResult[];
      setBatchResults(results);
      setBatchSummary({
        attempted: typeof data.attempted === "number" ? data.attempted : results.length,
        skipped: typeof data.skipped === "number" ? data.skipped : 0,
      });
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Failed to open PRs.");
    } finally {
      setBusy(false);
    }
  }

  const count = selectable.filter((r) => selected.has(r.fullName)).length;

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <button
        onClick={() => setShowBatch((s) => !s)}
        aria-expanded={showBatch}
        className="font-mono text-sm uppercase tracking-widest text-accent hover:text-white"
      >
        {showBatch ? "▾" : "▸"} Roll out to the fleet ({gapRepos.length} repos)
      </button>
      {showBatch && (
        <div className="mt-2">
          <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-sm text-slate-500">
            <button onClick={() => setSelected(new Set(selectable.map((r) => r.fullName)))} className="hover:text-white">
              select all
            </button>
            <button onClick={() => setSelected(new Set())} className="hover:text-white">
              none
            </button>
            <span>{count} selected</span>
            {openPrs.size > 0 && <span className="text-slate-600">{openPrs.size} already in flight</span>}
          </div>
          <div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
            {gapRepos.map((r) => {
              const live = openPrs.get(r.fullName);
              return live ? (
                <div key={r.fullName} className="flex items-center gap-2 font-mono text-sm text-slate-500">
                  <span aria-hidden className="text-accent">
                    ◆
                  </span>
                  <span className="truncate">{r.name}</span>
                  <a
                    href={live.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap text-accent underline hover:text-white"
                  >
                    PR #{live.prNumber} open
                  </a>
                </div>
              ) : (
                <label key={r.fullName} className="flex items-center gap-2 font-mono text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={selected.has(r.fullName)}
                    onChange={() => toggleSelected(r.fullName)}
                    className="accent-accent"
                  />
                  {r.name}
                </label>
              );
            })}
          </div>
          <button
            onClick={() => setConfirmingBatch(true)}
            // Mutually locked with the single-repo apply (practices #5): while a preview/apply is
            // in flight, block the batch so the two can't double-write concurrently.
            disabled={batchBusy || singleBusy || count === 0}
            className="mt-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {batchBusy ? `Opening ${count} PRs…` : `Open draft PRs across ${count} repo${count === 1 ? "" : "s"} →`}
          </button>
          {batchError && <p className="mt-2 text-sm text-orange-300">{batchError}</p>}
          <PracticeApplyBatchResults batchResults={batchResults} batchSummary={batchSummary} />
        </div>
      )}

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect
          runs. The overlay blocks the checkbox grid, so `selected` is frozen while confirming. */}
      <ConfirmAction
        open={confirmingBatch}
        busy={batchBusy}
        onCancel={() => setConfirmingBatch(false)}
        onConfirm={() => {
          setConfirmingBatch(false);
          void applyBatch();
        }}
        {...(count > 0
          ? batchPrConfirm(count, MAX_BATCH, batchOrg)
          : { title: "", body: "", confirmLabel: "", tone: "default" as const })}
      />
    </div>
  );
}
