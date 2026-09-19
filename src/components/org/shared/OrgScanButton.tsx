"use client";

// State/handlers live in useOrgScanButton.ts — this file is JSX only.

import Link from "next/link";
import { Meter } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
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
          className={`rounded-lg bg-accent px-4 py-2 type-body font-semibold text-on-accent transition ${
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
            title="Rescan only repos not scanned in the last 14 days: saves token budget"
            aria-describedby={noWatched ? hintId : undefined}
            className={`rounded-lg border border-slate-700 px-3 py-2 type-body text-slate-300 transition ${
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
            <p className="mt-1 truncate type-mono-sm text-slate-500">
              {p.total ? `Scanning ${p.done} of ${p.total}` : "Scanning"}
              {p.current ? ` · ${p.current}` : "…"}
            </p>
          </div>
        )}
        {!p.running && p.failed > 0 && !p.error && (
          <p className="type-body-sm text-warn">
            {p.failed} {p.failed === 1 ? "repo" : "repos"} failed to scan. See the Repositories tab.
          </p>
        )}
        {!p.running && p.skipped > 0 && !p.error && (
          <p className="type-body-sm text-warn">
            {p.skipped} {p.skipped === 1 ? "repo" : "repos"} skipped (out of scan credits).
          </p>
        )}
        {/* A DIFFERENT failure with a different fix: the org's installation token could not be
            minted. Its own line rather than a shared "skipped" count, because "buy credits" and
            "reconnect the GitHub App" are not the same instruction — and because a fleet where every
            repo skips this way used to settle as a clean, empty success. */}
        {!p.running && p.skippedNoToken > 0 && !p.error && (
          <p className="type-body-sm text-warn">
            {p.skippedNoToken} {p.skippedNoToken === 1 ? "repo" : "repos"} skipped — GitHub App access
            unavailable. Reconnect the installation on Connect.
          </p>
        )}
        {/* Time-budget stop — distinct from the network-error state below, and no longer an ASK.
            The repos this run reached are persisted; the remainder is a queued job the background
            worker finishes, so the surface is a count that ticks down on its own (polled in
            useOrgScanButton) rather than a "Continue" button handing the user back work the server
            dropped. It sits inside the same live region, so a screen-reader user hears it too. */}
        {!p.running && p.queued && !p.error && p.queued.pending > 0 && (
          <p className="type-body-sm text-warn">
            <span className="font-mono tabular-nums">{p.queued.pending}</span> queued — finishing in the background.
          </p>
        )}
        {p.error && <p className="type-body-sm text-danger">{p.error}</p>}
      </div>
      {!p.running && watchedCount === 0 && (
        <Link
          href={orgTabHref(org, "repositories")}
          className="focus-ring type-mono-sm text-slate-500 transition hover:text-accent"
        >
          Watch repos in Repositories →
        </Link>
      )}
    </div>
  );
}
