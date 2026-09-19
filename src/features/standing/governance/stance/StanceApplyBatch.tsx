"use client";

// Fleet half of "open AI_POLICY.md PRs" — extracted so StanceApplyControl stays under the 200-LOC
// cap. Mirrors PracticeApplyBatch: checkbox selection, confirm (batchPrConfirm), MAX_BATCH 25,
// mutually locked with the single-repo preview/apply. Posts /api/org/ai-stance/apply-batch.

import { useState } from "react";
import { ConfirmAction, batchPrConfirm } from "@/components/ConfirmAction";

const MAX_BATCH = 25;

type BatchResult = { repo: string; ok: boolean; url?: string; reused?: boolean; error?: string };

export function StanceApplyBatch({
  org,
  repos,
  version,
  singleBusy,
  onBusyChange,
}: {
  org: string;
  repos: string[];
  version: number;
  singleBusy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(repos));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [summary, setSummary] = useState<{ attempted: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const count = repos.filter((r) => selected.has(r)).length;

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
    const chosen = repos.filter((r) => selected.has(r));
    if (chosen.length === 0) return;
    setRunning(true);
    setError(null);
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch("/api/org/ai-stance/apply-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repos: chosen }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open PRs.");
      const rows = data.results as BatchResult[];
      setResults(rows);
      setSummary({
        attempted: typeof data.attempted === "number" ? data.attempted : rows.length,
        skipped: typeof data.skipped === "number" ? data.skipped : 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open PRs.");
    } finally {
      setRunning(false);
    }
  }

  const opened = results?.filter((r) => r.ok).length ?? 0;
  const failed = (results?.length ?? 0) - opened;
  const showCap =
    results && summary && (failed > 0 || summary.skipped > 0);

  return (
    <div data-testid="stance-apply-batch" className="mt-3 border-t border-slate-800 pt-3">
      <button
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        className="type-mono-sm uppercase tracking-widest text-accent hover:text-white"
      >
        {open ? "▾" : "▸"} Roll out to the fleet ({repos.length} repos)
      </button>
      {open && (
        <div className="mt-2">
          <div className="mb-2 flex flex-wrap items-center gap-3 type-mono-sm text-slate-500">
            <button onClick={() => setSelected(new Set(repos))} className="hover:text-white">
              select all
            </button>
            <button onClick={() => setSelected(new Set())} className="hover:text-white">
              none
            </button>
            <span>{count} selected</span>
            <span className="text-slate-600">max {MAX_BATCH} per run</span>
          </div>
          <div className="grid max-h-44 gap-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
            {repos.map((r) => (
              <label key={r} className="flex items-center gap-2 type-mono-sm text-slate-300">
                <input type="checkbox" checked={selected.has(r)} onChange={() => toggle(r)} className="accent-accent" />
                <span className="truncate">{r.split("/").pop()}</span>
              </label>
            ))}
          </div>
          <button
            onClick={() => setConfirming(true)}
            disabled={busy || singleBusy || count === 0}
            className="mt-3 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? `Opening ${count} PRs…` : `Open draft PRs across ${count} repo${count === 1 ? "" : "s"} →`}
          </button>
          {error && <p className="mt-2 type-body-sm text-orange-300">{error}</p>}
          {showCap && summary && (
            <p className="mt-2 type-body-sm text-amber-300">
              Opened {opened} of {summary.attempted} attempted
              {failed > 0 ? ` (${failed} failed)` : ""}
              {summary.skipped > 0
                ? `; ${summary.skipped} more over the per-batch cap of ${MAX_BATCH}. Re-run to open the rest.`
                : ""}
            </p>
          )}
          {results && (
            <ul data-testid="stance-batch-results" className="mt-2 space-y-1">
              {results.map((res, i) => (
                <li key={`${res.repo}-${i}`} className="type-mono-sm">
                  {res.ok ? (
                    <span className="text-emerald-300">
                      ✓ {res.repo.split("/").pop()}:{" "}
                      <a href={res.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
                        {res.reused ? "existing PR" : "PR opened"}
                      </a>
                    </span>
                  ) : (
                    <span className="text-orange-300">
                      ✗ {res.repo.split("/").pop()}: {res.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
      <span className="sr-only">Rolling out AI_POLICY.md v{version}</span>
    </div>
  );
}
