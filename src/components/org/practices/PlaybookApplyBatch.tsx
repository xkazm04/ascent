"use client";

// The FLEET ROLLOUT half of a playbook's apply action (G7-24) — the exact sibling of
// PracticeApplyBatch, for org-AUTHORED playbooks rather than mined practices. Extracted into its own
// file (rather than grown inside PlaybookCard) so that card stays under the 300-LOC cap.
//
// The scope it offers is whatever `repoOptions` the page passed in — the org's repos under the CURRENT
// segment / tech-stack scope — so "roll out to this segment" and "roll out to the fleet" are the same
// control viewed through the page's own filter, not a second, divergent notion of scope.
//
// Default selection excludes repos already marked as having adopted the playbook: re-applying there
// would only re-surface the same `ascent/playbook-<id>-…` branch, so counting them would overstate the
// action. They stay selectable (a closed-unmerged PR is a legitimate re-open) but are labelled.

import { useState } from "react";
import { ConfirmAction, batchPrConfirm } from "@/components/ConfirmAction";
import { MAX_BATCH, type BatchResult } from "./practice-apply-shared";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";

export function PlaybookApplyBatch({
  playbookId,
  title,
  org,
  repoOptions,
  applied,
  singleBusy,
  onBusyChange,
  onApplied,
}: {
  playbookId: string;
  title: string;
  /** Org slug — named in the confirm, so the dialog says whose repos are about to receive PRs. */
  org: string;
  repoOptions: string[];
  /** Repos already marked as adopting this playbook. */
  applied: string[];
  /** A single-repo apply/PR is in flight — the batch stays locked (and vice versa). */
  singleBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  /** Repos whose PR opened successfully, so the card's adoption chips update without a reload. */
  onApplied: (repos: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(repoOptions.filter((r) => !applied.includes(r))),
  );
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [summary, setSummary] = useState<{ attempted: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (repoOptions.length === 0) return null;

  const count = repoOptions.filter((r) => selected.has(r)).length;

  function setRunning(b: boolean) {
    setBusy(b);
    onBusyChange(b);
  }

  function toggle(repo: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  }

  async function run() {
    // Send NOT-YET-ADOPTED repos first: the server keeps the first MAX_BATCH it receives when
    // truncating, so the cap must never silently drop exactly the repos the rollout is for.
    const chosen = repoOptions.filter((r) => selected.has(r));
    const repos = [...chosen.filter((r) => !applied.includes(r)), ...chosen.filter((r) => applied.includes(r))];
    if (repos.length === 0) return;
    setRunning(true);
    setError(null);
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/org/playbooks/${playbookId}/apply-batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PRs.");
      const rows = data.results as BatchResult[];
      setResults(rows);
      setSummary({
        attempted: typeof data.attempted === "number" ? data.attempted : rows.length,
        skipped: typeof data.skipped === "number" ? data.skipped : 0,
      });
      // The route records the adoption mark per successful repo; mirror that locally so the card's
      // chips + lift denominator match the server without a reload.
      onApplied(rows.filter((r) => r.ok).map((r) => r.repo));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open PRs.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <button
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        className="font-mono text-sm uppercase tracking-widest text-accent hover:text-white"
      >
        {open ? "▾" : "▸"} Roll out to the fleet ({repoOptions.length} repos)
      </button>
      {open && (
        <div className="mt-2">
          <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-sm text-slate-500">
            <button onClick={() => setSelected(new Set(repoOptions))} className="hover:text-white">
              select all
            </button>
            <button onClick={() => setSelected(new Set())} className="hover:text-white">
              none
            </button>
            <span>{count} selected</span>
            <span className="text-slate-600">max {MAX_BATCH} per run</span>
          </div>
          <div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
            {repoOptions.map((r) => (
              <label key={r} className="flex items-center gap-2 font-mono text-sm text-slate-300">
                <input type="checkbox" checked={selected.has(r)} onChange={() => toggle(r)} className="accent-accent" />
                <span className="truncate">{r.split("/").pop()}</span>
                {applied.includes(r) && <span className="shrink-0 text-slate-600">· adopted</span>}
              </label>
            ))}
          </div>
          <button
            onClick={() => setConfirming(true)}
            disabled={busy || singleBusy || count === 0}
            className="mt-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? `Opening ${count} PRs…` : `Open draft PRs across ${count} repo${count === 1 ? "" : "s"} →`}
          </button>
          {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
          <PracticeApplyBatchResults batchResults={results} batchSummary={summary} />
        </div>
      )}

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect
          runs. The overlay blocks the checkbox grid, so `selected` is frozen while confirming. */}
      <ConfirmAction
        open={confirming}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run();
        }}
        {...(count > 0
          ? batchPrConfirm(count, MAX_BATCH, org)
          : { title: "", body: "", confirmLabel: "", tone: "default" as const })}
      />
      {/* Name WHAT is being rolled out — batchPrConfirm's copy is generic across practices/playbooks. */}
      <span className="sr-only">Rolling out the “{title}” playbook</span>
    </div>
  );
}
