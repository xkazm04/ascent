"use client";

// Searchable, paginated audit-trail viewer for the org dashboard. Mirrors the audit
// surfaces in Stripe/GitHub/Datadog: filter by action, page with a keyset cursor, and —
// where an entry references a scan — link straight to that pinned report so you can see
// who triggered the scan that moved a score.

import { useState } from "react";
import Link from "next/link";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";
import { timeAgo } from "@/lib/ui";

const ACTION_META: Record<string, { label: string; cls: string }> = {
  "scan.created": { label: "Scan", cls: "border-accent/40 bg-accent/10 text-accent" },
  "recommendation.status_changed": {
    label: "Rec status",
    cls: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  },
};

const ACTION_FILTERS = [
  { value: "", label: "All actions" },
  { value: "scan.created", label: "Scans" },
  { value: "recommendation.status_changed", label: "Recommendation updates" },
];

function ActionBadge({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { label: action, cls: "border-slate-600 bg-slate-700/30 text-slate-300" };
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${m.cls}`}>
      {m.label}
    </span>
  );
}

function Details({ entry }: { entry: AuditLogEntry }) {
  if (entry.scan) {
    const s = entry.scan;
    const permalink = s.repo ? `/report/${s.repo}${s.headSha ? `@${s.headSha}` : ""}` : null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {s.repo && <span className="font-mono text-xs text-white">{s.repo}</span>}
        {s.level && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
            {s.level}
            {s.overall != null ? ` · ${s.overall}` : ""}
          </span>
        )}
        {s.headSha && <span className="font-mono text-[11px] text-slate-500">{s.headSha.slice(0, 7)}</span>}
        {permalink && (
          <Link href={permalink} className="font-mono text-[11px] text-accent hover:text-accent-soft">
            view report →
          </Link>
        )}
      </div>
    );
  }
  // Non-scan entries: surface the most useful meta field(s) compactly.
  const status = typeof entry.meta.status === "string" ? entry.meta.status : null;
  const id = typeof entry.meta.id === "string" ? entry.meta.id : null;
  if (status) {
    return (
      <span className="font-mono text-xs text-slate-300">
        {id ? `${id.slice(0, 8)}… → ` : ""}
        <span className="text-white">{status}</span>
      </span>
    );
  }
  return <span className="text-xs text-slate-600">—</span>;
}

export function AuditLogViewer({ org, initial }: { org: string; initial: AuditLogPage }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean, nextCursor: string | null, actionFilter: string) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ org });
      if (actionFilter) qs.set("action", actionFilter);
      if (!reset && nextCursor) qs.set("cursor", nextCursor);
      const res = await fetch(`/api/audit?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status}).`);
      setEntries((prev) => (reset ? data.entries : [...prev, ...data.entries]));
      setCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  }

  function changeAction(value: string) {
    setAction(value);
    void load(true, null, value);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Filter</span>
          <select
            value={action}
            onChange={(e) => changeAction(e.target.value)}
            aria-label="Filter by action"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-accent"
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="font-mono text-[11px] text-slate-500">{entries.length} shown</span>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No entries match this filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-900/60 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Actor</th>
                <th className="px-4 py-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {entries.map((e) => (
                <tr key={e.id} className="align-top text-slate-300">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400" title={e.at}>
                    {timeAgo(e.at)}
                  </td>
                  <td className="px-3 py-2">
                    <ActionBadge action={e.action} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-400">
                    {e.actorId ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Details entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => load(false, cursor, action)}
            disabled={loading}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
