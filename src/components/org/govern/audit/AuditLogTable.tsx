"use client";

// The table body (+ integrity banner, error banner, loading pill, empty state, load-more) for the
// audit-trail viewer. Extracted from AuditLogViewer.tsx (JSX region split, per
// docs/ORG-TABS-REFACTOR.md) to keep the viewer under the 200-LOC cap.

import type { AuditLogEntry } from "@/lib/db";
import { timeAgo } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { ActionBadge, Details, IntegrityBadge } from "./AuditLogCells";

export function AuditLogTable({
  entries,
  loading,
  error,
  cursor,
  onLoadMore,
}: {
  entries: AuditLogEntry[];
  loading: boolean;
  error: string | null;
  cursor: string | null;
  onLoadMore: () => void;
}) {
  // Per-row tamper-evidence, verified on READ by getAuditLog (the same verdict the CSV export carries).
  // The column is hidden entirely when the deployment has no signing secret — every row would read
  // "no-secret", which is noise, not evidence. `unsigned` legacy rows keep the column meaningful without
  // being alarming; only a genuine signature MISMATCH raises the banner below.
  const showIntegrity = entries.some((e) => e.integrity && e.integrity !== "no-secret");
  const tamperedCount = entries.filter((e) => e.integrity === "tampered").length;

  return (
    <>
      {tamperedCount > 0 && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-base text-red-300">
          <span className="font-mono text-sm uppercase tracking-widest">Integrity failure</span>:{" "}
          {tamperedCount} {tamperedCount === 1 ? "entry does" : "entries do"} not match the signature recorded
          when {tamperedCount === 1 ? "it was" : "they were"} written. {tamperedCount === 1 ? "That row" : "Those rows"}{" "}
          may have been altered directly in the database; do not file {tamperedCount === 1 ? "it" : "them"} as evidence.
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-base text-red-300">
          {error}
        </div>
      )}

      {/* Pending state: while a fetch is in flight the rows below are STALE (a just-applied filter hasn't
          landed yet). Dim them, mark the region aria-busy, and float an announced "Loading…" pill so the
          user knows the table is refreshing instead of trusting rows that no longer match the filter. */}
      <div
        aria-busy={loading}
        className={`relative transition-opacity duration-150 ${loading ? "opacity-50" : ""}`}
      >
        {loading && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
            <span
              role="status"
              aria-live="polite"
              className="mt-4 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1 font-mono text-sm text-slate-300 shadow-lg"
            >
              Loading…
            </span>
          </div>
        )}
        {entries.length === 0 ? (
          <EmptyState
            variant="section"
            icon="🗒️"
            title="No audit entries"
            body={loading ? "Loading…" : "No entries match this filter."}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full min-w-[640px] text-base">
              <thead className="bg-slate-900/60 font-mono text-sm uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  {showIntegrity && <th className="px-3 py-2 text-left">Integrity</th>}
                  <th className="px-4 py-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {entries.map((e) => (
                  <tr key={e.id} className="align-top text-slate-300">
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-400" title={e.at}>
                      {timeAgo(e.at)}
                    </td>
                    <td className="px-3 py-2">
                      <ActionBadge action={e.action} />
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className="max-w-[12rem] truncate font-mono text-sm text-slate-400"
                        title={e.actorId ?? undefined}
                      >
                        {e.actorId ?? "—"}
                      </div>
                    </td>
                    {showIntegrity && (
                      <td className="px-3 py-2">
                        <IntegrityBadge verdict={e.integrity} />
                      </td>
                    )}
                    <td className="max-w-[24rem] px-4 py-2">
                      <Details entry={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {cursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
