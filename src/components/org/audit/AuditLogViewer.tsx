"use client";

// Searchable, paginated audit-trail viewer for the org dashboard. Mirrors the audit
// surfaces in Stripe/GitHub/Datadog: filter by action, page with a keyset cursor, and —
// where an entry references a scan — link straight to that pinned report so you can see
// who triggered the scan that moved a score.

import { useRef, useState } from "react";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";
import { timeAgo } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { ACTION_FILTERS, ActionBadge, Details, IntegrityBadge } from "./AuditLogCells";

interface Filters {
  action: string;
  since: string;
  until: string;
  actor: string;
}

const NO_FILTERS: Filters = { action: "", since: "", until: "", actor: "" };

export function AuditLogViewer({ org, initial }: { org: string; initial: AuditLogPage }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [actor, setActor] = useState("");
  // security-posture-audit-log #5: the LAST-APPLIED filter set, distinct from the live inputs above.
  // The CSV href, "Load more", and the table all derive from THIS — previously the CSV anchor was
  // rebuilt from raw input state on every keystroke, so typing an actor without pressing Apply
  // exported a filter set the on-screen table had never shown (filed evidence ≠ reviewed rows).
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request token: every load() takes the next id; a response only applies if it's still the
  // latest. Without it, rapidly changing the action filter raced two un-sequenced fetches and whichever
  // resolved LAST won — landing rows that disagree with the selected filter, or appending a "Load more"
  // page from a superseded filter (duplicate / foreign e.id rows, possible React key collisions).
  const reqId = useRef(0);

  function buildQs(f: Filters): URLSearchParams {
    const qs = new URLSearchParams({ org });
    if (f.action) qs.set("action", f.action);
    if (f.since) qs.set("since", f.since);
    if (f.until) qs.set("until", f.until);
    if (f.actor.trim()) qs.set("actorId", f.actor.trim());
    return qs;
  }

  async function load(reset: boolean, nextCursor: string | null, f: Filters) {
    const myReq = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = buildQs(f);
      if (!reset && nextCursor) qs.set("cursor", nextCursor);
      const res = await fetch(`/api/audit?${qs.toString()}`);
      const data = await res.json();
      // A newer load() superseded this one — drop the stale result so it can't scramble the list or
      // append a page belonging to a prior filter.
      if (myReq !== reqId.current) return;
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status}).`);
      setEntries((prev) => (reset ? data.entries : [...prev, ...data.entries]));
      setCursor(data.nextCursor);
    } catch (e) {
      if (myReq !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load audit log.");
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }

  // Explicit values passed to load() so a just-changed control isn't read from stale state. The
  // Action select auto-applies (over the last-APPLIED date/actor set — mixing in typed-but-unapplied
  // inputs would silently apply filters the user never confirmed); date/actor apply via the form's
  // submit (the Apply button, or Enter in any field).
  function changeAction(value: string) {
    setAction(value);
    const f = { ...applied, action: value };
    setApplied(f);
    void load(true, null, f);
  }
  function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    const f = { action, since, until, actor };
    setApplied(f);
    void load(true, null, f);
  }
  /** Download href for the APPLIED filter set — the CSV always matches the rows on screen. */
  const csvHref = `/api/audit?${buildQs(applied).toString()}&format=csv`;

  // Per-row tamper-evidence, verified on READ by getAuditLog (the same verdict the CSV export carries).
  // The column is hidden entirely when the deployment has no signing secret — every row would read
  // "no-secret", which is noise, not evidence. `unsigned` legacy rows keep the column meaningful without
  // being alarming; only a genuine signature MISMATCH raises the banner below.
  const showIntegrity = entries.some((e) => e.integrity && e.integrity !== "no-secret");
  const tamperedCount = entries.filter((e) => e.integrity === "tampered").length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        {/* A real <form> so Enter in the actor/date fields submits (keyboard users previously had no
            way to apply from a text input — the field appeared to "do nothing"). */}
        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 text-base text-slate-400">
            <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Action</span>
            <select
              value={action}
              onChange={(e) => changeAction(e.target.value)}
              disabled={loading}
              aria-label="Filter by action"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
            >
              {ACTION_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
            since
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="From date"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent" />
          </label>
          <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
            until
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="To date"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent" />
          </label>
          <input type="text" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="actor (login)" aria-label="Filter by actor"
            className="w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent" />
          <button type="submit" disabled={loading}
            className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50">
            Apply
          </button>
        </form>
        <div className="flex items-center gap-3">
          <a href={csvHref} className="font-mono text-sm text-accent transition hover:text-white" title="Download all matching entries as CSV">
            Download CSV ↓
          </a>
          <span className="font-mono text-sm text-slate-500">{entries.length} shown</span>
        </div>
      </div>

      {tamperedCount > 0 && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-base text-red-300">
          <span className="font-mono text-sm uppercase tracking-widest">Integrity failure</span> —{" "}
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
            onClick={() => load(false, cursor, applied)}
            disabled={loading}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
