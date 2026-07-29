"use client";

// State/handlers live in useOrgScanButton.ts — this file is JSX only.

import Link from "next/link";
import { Meter } from "@/components/org/shared/ui";
import { useOrgScanButton } from "./useOrgScanButton";

export function OrgScanButton({ org, watchedCount }: { org: string; watchedCount: number }) {
  const { p, hintId, noWatched, inert, run, pct, isDemoOrg } = useOrgScanButton(org, watchedCount);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run()}
          aria-disabled={inert || undefined}
          title={noWatched ? "Watch repositories on Connect to enable scanning" : undefined}
          aria-describedby={noWatched ? hintId : undefined}
          className={`rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition ${
            inert ? "cursor-not-allowed opacity-50" : "hover:bg-accent-soft"
          }`}
        >
          {p.running
            ? p.total
              ? `Scanning ${p.done}/${p.total}…`
              : "Scanning…"
            : `Scan all watched (${watchedCount})`}
        </button>
        {!isDemoOrg && (
          <button
            type="button"
            onClick={() => run({ staleOnlyDays: 14 })}
            aria-disabled={inert || undefined}
            title="Rescan only repos not scanned in the last 14 days — saves token budget"
            aria-describedby={noWatched ? hintId : undefined}
            className={`rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition ${
              inert ? "cursor-not-allowed opacity-50" : "hover:border-accent hover:text-white"
            }`}
          >
            Stale only
          </button>
        )}
      </div>
      {noWatched && (
        <span id={hintId} className="sr-only">
          Watch repositories on Connect to enable scanning
        </span>
      )}
      {/* One polite live region for the whole async lifecycle (progress + partial-outcome + error), so a
          keyboard/AT user who tabs away still hears that the long fleet scan progressed, finished, partly
          failed, was capped for credits, or errored. The meter is visual only (aria-hidden); the text
          carries the announcement. aria-atomic re-reads the region as a unit on each change. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="flex flex-col items-end gap-1">
        {p.running && (
          <div className="w-48">
            <div aria-hidden="true">
              <Meter value={Math.max(4, pct)} size="sm" />
            </div>
            <p className="mt-1 truncate font-mono text-sm text-slate-500">
              {p.total ? `Scanning ${p.done} of ${p.total}` : "Scanning"}
              {p.current ? ` — ${p.current}` : "…"}
            </p>
          </div>
        )}
        {!p.running && p.failed > 0 && !p.error && (
          <p className="text-sm text-warn">
            {p.failed} {p.failed === 1 ? "repo" : "repos"} failed to scan — see the Repositories tab.
          </p>
        )}
        {!p.running && p.skipped > 0 && !p.error && (
          <p className="text-sm text-warn">
            {p.skipped} {p.skipped === 1 ? "repo" : "repos"} skipped — out of scan credits.
          </p>
        )}
        {/* Time-budget stop — distinct from the network-error state below. The run succeeded for the
            repos it reached (they are persisted); the remainder was never started, so continuing costs
            nothing for work already done. The button carries the exact remainder, so a continue walks
            only what's left. */}
        {!p.running && p.truncated && !p.error && p.truncated.repos.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <p className="text-sm text-warn">
              Time budget reached —{" "}
              <span className="font-mono tabular-nums">
                {p.truncated.scanned} of {p.truncated.total}
              </span>{" "}
              scanned.
            </p>
            <button
              type="button"
              onClick={() => run({ repos: p.truncated?.repos })}
              className="focus-ring rounded-lg border border-divider px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
            >
              Continue ({p.truncated.repos.length} left)
            </button>
          </div>
        )}
        {p.error && <p className="text-sm text-danger">{p.error}</p>}
      </div>
      {!p.running && watchedCount === 0 && (
        <Link
          href="/connect"
          className="focus-ring font-mono text-sm text-slate-500 transition hover:text-accent"
        >
          Watch repos on Connect →
        </Link>
      )}
    </div>
  );
}
