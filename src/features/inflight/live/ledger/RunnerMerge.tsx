"use client";

// "MERGE RUNNER INTO <base>" — the one door that brings the runner's accumulated work into the
// operator's branch, and only as a fast-forward nobody's working copy can be hurt by
// (`mergeRunnerInto`). Owner-only, behind a confirm step. The three answers are rendered as what they
// are: the base moved (`fast-forward`), the checkout that has it fast-forwarded (`merged`), or — when
// the branches diverged or the checkout is dirty — the exact commands, which are the operator's to run.
// A `commands` answer is not a failure; a failed request is, and says so without claiming anything moved.

import { useState } from "react";
import { CopyCommand } from "./CopyCommand";
import { shortSha } from "./ledgerFormat";
import { RUNNER_BRANCH } from "./ledgerModel";
import { mergeRunner } from "./ledgerClient";
import type { RunnerMergeResponse } from "./ledgerTypes";

export function RunnerMerge({
  slug,
  repo,
  base,
  ahead,
  onMerged,
}: {
  slug: string;
  repo: string;
  base: string;
  /** Commits to bring in; 0 disables the button (nothing to merge), null is unknown (still allowed). */
  ahead: number | null;
  onMerged: (repo: string, result: RunnerMergeResponse) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunnerMergeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await mergeRunner(slug, repo);
      setResult(out);
      onMerged(repo, out);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The merge request failed."} Nothing was merged.`);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div data-testid="runner-merge" className="space-y-2">
      {!confirming ? (
        <button
          type="button"
          disabled={busy || ahead === 0}
          title={ahead === 0 ? `${base} already contains ${RUNNER_BRANCH} — nothing to merge.` : undefined}
          onClick={() => setConfirming(true)}
          className="focus-ring rounded-lg border border-divider px-3 py-1.5 type-caption text-slate-200 hover:border-accent disabled:opacity-50"
        >
          Merge runner into {base}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 type-caption">
          <span className="text-slate-300">
            Bring {RUNNER_BRANCH} into <span className="font-mono">{base}</span>? Only a fast-forward is made; nothing is forced.
          </span>
          <button
            type="button"
            onClick={() => void merge()}
            disabled={busy}
            className="focus-ring rounded-lg bg-accent px-3 py-1 font-semibold text-on-accent hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? "Merging…" : "Confirm merge"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="focus-ring rounded px-2 py-1 text-slate-400 hover:text-white">
            Cancel
          </button>
        </div>
      )}

      {result?.ok && (
        <p data-testid="merge-outcome" data-outcome={result.outcome} role="status" className="type-body-sm text-success-soft">
          {result.outcome === "fast-forward"
            ? `Fast-forwarded ${result.base} to ${shortSha(result.mergedSha)} — no working copy was touched.`
            : `Merged into ${result.base} in your checkout (${shortSha(result.mergedSha)}).`}{" "}
          <span className="text-slate-500">{result.note}</span>
        </p>
      )}
      {result && !result.ok && (
        <div data-testid="merge-outcome" data-outcome="commands" role="status">
          <p className="type-body-sm text-warn">{result.note}</p>
          {result.commands.length > 0 ? (
            <CopyCommand lines={result.commands} />
          ) : (
            <p className="type-caption text-slate-500">There is no command to offer — the branch this needs does not exist in the checkout.</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="type-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
