"use client";

// Searchable, paginated audit-trail viewer for the org dashboard. Mirrors the audit
// surfaces in Stripe/GitHub/Datadog: filter by action, page with a keyset cursor, and —
// where an entry references a scan — link straight to that pinned report so you can see
// who triggered the scan that moved a score.

import { useState } from "react";
import Link from "next/link";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";
import { timeAgo } from "@/lib/ui";

// One ordered list of the audit actions the app actually records, driving BOTH the badge metadata
// and the filter dropdown — so they can't drift apart (the prior bug keyed on
// `recommendation.status_changed`, which is never written; the real action is `recommendation.updated`,
// and scan.regression / org.alerts.* / *.pr_opened / member.* / plan / retention were unrecognized).
const ACTIONS: { value: string; label: string; cls: string }[] = [
  { value: "scan.created", label: "Scan", cls: "border-accent/40 bg-accent/10 text-accent" },
  { value: "recommendation.updated", label: "Rec update", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "scan.regression", label: "Regression", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  { value: "org.alerts.webhook", label: "Alert sink", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org.alerts.thresholds", label: "Alert rules", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "practice.pr_opened", label: "Practice PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "playbook.pr_opened", label: "Playbook PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "org.member.role", label: "Member role", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.member.removed", label: "Member removed", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "org.member.invited", label: "Member invited", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.plan", label: "Plan change", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "retention.purged", label: "Retention purge", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
];

const ACTION_META: Record<string, { label: string; cls: string }> = Object.fromEntries(
  ACTIONS.map((a) => [a.value, { label: a.label, cls: a.cls }]),
);

const ACTION_FILTERS = [{ value: "", label: "All actions" }, ...ACTIONS.map((a) => ({ value: a.value, label: a.label }))];

function ActionBadge({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { label: action, cls: "border-slate-600 bg-slate-700/30 text-slate-300" };
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest ${m.cls}`}>
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
        {s.repo && <span className="font-mono text-sm text-white">{s.repo}</span>}
        {s.level && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-300">
            {s.level}
            {s.overall != null ? ` · ${s.overall}` : ""}
          </span>
        )}
        {s.headSha && <span className="font-mono text-sm text-slate-500">{s.headSha.slice(0, 7)}</span>}
        {permalink && (
          <Link href={permalink} className="font-mono text-sm text-accent hover:text-accent-soft">
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
      <span className="font-mono text-sm text-slate-300">
        {id ? `${id.slice(0, 8)}… → ` : ""}
        <span className="text-white">{status}</span>
      </span>
    );
  }
  return <span className="text-sm text-slate-600">—</span>;
}

export function AuditLogViewer({ org, initial }: { org: string; initial: AuditLogPage }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>(initial.entries);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [action, setAction] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  interface Filters {
    action: string;
    since: string;
    until: string;
    actor: string;
  }

  function buildQs(f: Filters): URLSearchParams {
    const qs = new URLSearchParams({ org });
    if (f.action) qs.set("action", f.action);
    if (f.since) qs.set("since", f.since);
    if (f.until) qs.set("until", f.until);
    if (f.actor.trim()) qs.set("actorId", f.actor.trim());
    return qs;
  }

  async function load(reset: boolean, nextCursor: string | null, f: Filters) {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQs(f);
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

  // Explicit values passed to load() so a just-changed control isn't read from stale state.
  function changeAction(value: string) {
    setAction(value);
    void load(true, null, { action: value, since, until, actor });
  }
  function applyFilters() {
    void load(true, null, { action, since, until, actor });
  }
  /** Download href for the current filter set — a plain anchor triggers the CSV attachment. */
  const csvHref = `/api/audit?${buildQs({ action, since, until, actor }).toString()}&format=csv`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 text-base text-slate-400">
            <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Action</span>
            <select
              value={action}
              onChange={(e) => changeAction(e.target.value)}
              aria-label="Filter by action"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
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
          <button onClick={applyFilters} disabled={loading}
            className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50">
            Apply
          </button>
        </div>
        <div className="flex items-center gap-3">
          <a href={csvHref} className="font-mono text-sm text-accent transition hover:text-white" title="Download all matching entries as CSV">
            Download CSV ↓
          </a>
          <span className="font-mono text-sm text-slate-500">{entries.length} shown</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-base text-red-300">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-base text-slate-400">
          No entries match this filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full min-w-[640px] text-base">
            <thead className="bg-slate-900/60 font-mono text-sm uppercase tracking-widest text-slate-500">
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
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-slate-400" title={e.at}>
                    {timeAgo(e.at)}
                  </td>
                  <td className="px-3 py-2">
                    <ActionBadge action={e.action} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-slate-400">
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
            onClick={() => load(false, cursor, { action, since, until, actor })}
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
