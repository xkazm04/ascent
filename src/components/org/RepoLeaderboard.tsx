"use client";

// The Repositories-tab leaderboard with row selection + a sticky bulk-action bar: tick repos, then
// tag the whole set into a segment in one call (POST /api/org/segments/:id/repos/bulk). The table
// markup mirrors the prior server render; only selection + the bar are client state.

import { useMemo, useState } from "react";
import Link from "next/link";
import { OrgTable, postureLabel } from "@/components/org/ui";
import { ScheduleSelect } from "@/components/org/ScheduleSelect";
import { RepoRescanButton } from "@/components/org/RepoRescanButton";
import { LEVEL_CLASSES, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

interface LeaderRow {
  fullName: string;
  name: string;
  watched: boolean;
  scanSchedule: string;
  lastScanStatus: string | null;
  lastScanError: string | null;
  aiConformance: number | null;
  latest: { level: string; overall: number; adoption: number; rigor: number; posture: string; scannedAt: string } | null;
}

interface SegmentItem {
  id: string;
  name: string;
}

export function RepoLeaderboard({
  slug,
  rows,
  segments,
  schedulable,
}: {
  slug: string;
  rows: LeaderRow[];
  segments: SegmentItem[];
  schedulable: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSelected = selected.size > 0 && selected.size === rows.length;
  const segName = useMemo(() => new Map(segments.map((s) => [s.id, s.name])), [segments]);

  function toggle(fullName: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
    setDone(null);
  }
  function toggleAll() {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.fullName))));
    setDone(null);
  }

  async function addToSegment() {
    if (!target || selected.size === 0) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/org/segments/${target}/repos/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, fullNames: [...selected], member: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Bulk add failed.");
      setDone(`Added ${selected.size} to ${segName.get(target) ?? "segment"}.`);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk add failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <OrgTable
        className="mt-3"
        head={
          <tr>
            <th className="px-3 py-2 text-left">
              {segments.length > 0 && (
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all repositories" className="accent-accent" />
              )}
            </th>
            <th className="px-4 py-2 text-left">Repo</th>
            <th className="px-3 py-2 text-left">Level</th>
            <th className="px-3 py-2 text-right">Overall</th>
            <th className="px-3 py-2 text-right">Adopt</th>
            <th className="px-3 py-2 text-right">Rigor</th>
            <th className="px-3 py-2 text-left">Posture</th>
            <th className="px-3 py-2 text-left">Last scan</th>
            <th className="px-3 py-2 text-left">Autoscan</th>
            <th className="px-3 py-2 text-left">
              <span className="sr-only">Rescan</span>
            </th>
          </tr>
        }
      >
        {rows.map((r) => {
          const l = r.latest;
          const rlc = l ? LEVEL_CLASSES[l.level as LevelId] : null;
          return (
            <tr key={r.fullName} className="text-slate-300">
              <td className="px-3 py-2">
                {segments.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selected.has(r.fullName)}
                    onChange={() => toggle(r.fullName)}
                    aria-label={`Select ${r.fullName}`}
                    className="accent-accent"
                  />
                )}
              </td>
              <td className="px-4 py-2">
                <Link href={`/report?repo=${encodeURIComponent(r.fullName)}`} className="font-mono text-sm text-white hover:text-accent">
                  {r.fullName}
                </Link>
                {r.lastScanStatus === "error" && (
                  <span
                    title={r.lastScanError ?? "The most recent scan attempt failed."}
                    className="ml-2 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-sm text-danger-soft"
                  >
                    ⚠ scan failed
                  </span>
                )}
                {r.aiConformance != null && (
                  <span
                    title="`.ai/` standard conformance reported by this repo's doctor (node .ai/doctor.mjs --json)"
                    className="ml-2 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-sm"
                    style={{ color: scoreHex(r.aiConformance) }}
                  >
                    .ai {r.aiConformance}%
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {l && rlc ? <span className={`font-mono text-sm ${rlc.text}`}>{l.level}</span> : <span className="text-slate-600">—</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: l ? scoreHex(l.overall) : undefined }}>
                {l ? l.overall : "—"}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{l ? l.adoption : "—"}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{l ? l.rigor : "—"}</td>
              <td className="px-3 py-2 text-sm text-slate-400">{l ? postureLabel(l.posture) : "—"}</td>
              <td className="px-3 py-2 text-sm text-slate-500">{l ? l.scannedAt.slice(0, 10) : "not scanned"}</td>
              <td className="px-3 py-2">
                <ScheduleSelect
                  org={slug}
                  fullName={r.fullName}
                  schedule={r.scanSchedule}
                  disabled={!schedulable}
                  disabledHint="Autoscan scheduling requires the GitHub App."
                />
              </td>
              <td className="px-3 py-2">
                {r.watched ? (
                  <RepoRescanButton org={slug} fullName={r.fullName} disabled={!schedulable} disabledHint="Rescanning requires the GitHub App." />
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </OrgTable>

      {/* Sticky bulk-action bar — appears once repos are ticked. */}
      {selected.size > 0 && segments.length > 0 && (
        <div className="sticky bottom-4 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-slate-900/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="font-mono text-sm text-white">{selected.size} selected</span>
          <span className="font-mono text-sm text-slate-500">→ add to</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
          >
            <option value="">segment…</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            onClick={addToSegment}
            disabled={busy || !target}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
          <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:text-white">
            Clear
          </button>
          {error && <span className="font-mono text-sm text-orange-300">{error}</span>}
        </div>
      )}
      {done && <p className="mt-2 font-mono text-sm text-emerald-300">{done}</p>}
    </>
  );
}
