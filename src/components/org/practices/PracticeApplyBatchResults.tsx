import { MAX_BATCH, type BatchResult } from "./practice-apply-shared";

export function PracticeApplyBatchResults({
  batchResults,
  batchSummary,
}: {
  batchResults: BatchResult[] | null;
  batchSummary: { attempted: number; skipped: number } | null;
}) {
  return (
    <>
      {batchSummary &&
        batchResults &&
        (() => {
          // Report the count that ACTUALLY opened (results.ok), not `attempted` — a repo that
          // failed inside the pool is still counted in `attempted`, so "Opened {attempted}"
          // was crediting failures as opened PRs (practices #6). Stay silent on a clean run
          // (every repo opened, nothing over the cap); the per-repo ✓ list already shows those.
          const opened = batchResults.filter((r) => r.ok).length;
          const failed = batchResults.length - opened;
          if (failed === 0 && batchSummary.skipped === 0) return null;
          return (
            <p className="mt-2 text-sm text-amber-300">
              Opened {opened} of {batchSummary.attempted} attempted
              {failed > 0 ? ` (${failed} failed)` : ""}
              {batchSummary.skipped > 0
                ? ` — ${batchSummary.skipped} more over the per-batch cap of ${MAX_BATCH} (neediest repos first). Re-run to open the rest.`
                : ""}
            </p>
          );
        })()}
      {batchResults && (
        <ul className="mt-2 space-y-1">
          {/* Key includes the index: the server dedupes, but a defensive duplicate repo in
              the results must not blow up the list with colliding React keys. */}
          {batchResults.map((res, i) => (
            <li key={`${res.repo}-${i}`} className="font-mono text-sm">
              {res.ok ? (
                <span className="text-emerald-300">
                  ✓ {res.repo.split("/").pop()} —{" "}
                  <a href={res.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
                    {res.reused ? "existing PR" : "PR opened"}
                  </a>
                </span>
              ) : (
                <span className="text-orange-300">
                  ✗ {res.repo.split("/").pop()} — {res.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
