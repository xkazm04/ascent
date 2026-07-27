"use client";

// The Repositories-tab leaderboard with row selection + a sticky bulk-action bar: tick repos, then
// tag the whole set into a segment in one call (POST /api/org/segments/:id/repos/bulk). The table
// markup mirrors the prior server render; only selection + the bar are client state.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OrgTable } from "@/components/org/shared/ui";
import { ScheduleSelect } from "@/components/org/repositories/ScheduleSelect";
import { RepoRescanButton } from "@/components/org/repositories/RepoRescanButton";
import { TechBadges } from "@/components/org/repositories/TechBadges";
import { Sparkline } from "@/components/org/repositories/Sparkline";
import { LeaderboardHead, activityValue, sum, type RepoActivity, type SortKey, type SortState } from "@/components/org/repositories/RepoLeaderboardParts";
import { bulkTagRepos } from "@/lib/org/segment-actions";
import { LEVEL_CLASSES, fmtCompact, scoreHex } from "@/lib/ui";
import type { LevelId, TechStack } from "@/lib/types";

interface LeaderRow {
  fullName: string;
  name: string;
  watched: boolean;
  scanSchedule: string;
  lastScanStatus: string | null;
  lastScanError: string | null;
  aiConformance: number | null;
  techStack?: TechStack | null;
  activity: RepoActivity | null;
  // `latest` is kept only to gate the report link (link a scanned repo, render inert otherwise) — the
  // Overall/Adopt/Rigor/Posture columns it fed were dropped in favour of the activity columns.
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
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Column sort over the activity columns — a header click cycles most-first → least-first → default
  // (the incoming overall-maturity order). Selection state is keyed by fullName, so re-sorting the
  // rows never disturbs which repos are ticked.
  const [sort, setSort] = useState<SortState>(null);
  const router = useRouter();

  const cycleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const d = sort.dir;
    return [...rows].sort((x, y) => (activityValue(x.activity, sort.key) - activityValue(y.activity, sort.key)) * d);
  }, [rows, sort]);

  // Selection is keyed by fullName so RE-SORTING never disturbs it (see the sort comment above) — but
  // the ROW SET itself changes when the posture/stack filter chips navigate: the server page re-renders
  // around this still-mounted client component, and repos ticked under the old filter would silently
  // remain in `selected` while invisible. Prune to the visible rows so "Add to segment" can only ever
  // tag repos the user can currently see (repositories-segments 07-16 #1).
  // Derived during render rather than pruned back into state by an effect: the visible set is fully
  // knowable from `rawSelected` + `rows`, so storing it would mean an extra cascading render on every
  // filter change — and a frame where the stale tick is still live. Everything below reads `selected`,
  // so an off-screen repo can never reach "Add to segment"; the raw set is kept intact so navigating
  // back to a wider filter restores the ticks the user made there.
  const rowNames = useMemo(() => new Set(rows.map((r) => r.fullName)), [rows]);
  const selected = useMemo(
    () => (rawSelected.size === 0 ? rawSelected : new Set([...rawSelected].filter((fn) => rowNames.has(fn)))),
    [rawSelected, rowNames],
  );

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
      // bulkTagRepos returns the server's authoritative `changed` count (createMany skips repos already
      // tagged). Report THAT, not selected.size — telling the user "Added 10" when 7 were already tagged
      // and only 3 changed is success theater. Then router.refresh() so the sibling segment panel's chips
      // / repoCount and this leaderboard's server-rendered data re-hydrate (they used to stay stale).
      const name = segName.get(target) ?? "segment";
      const changed = await bulkTagRepos(target, { org: slug, fullNames: [...selected], member: true });
      setDone(
        changed === 0
          ? `All ${selected.size} selected were already tagged to ${name}.`
          : `Added ${changed} to ${name}.`,
      );
      setSelected(new Set());
      router.refresh();
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
          <LeaderboardHead
            hasSegments={segments.length > 0}
            allSelected={allSelected}
            onToggleAll={toggleAll}
            sort={sort}
            onCycle={cycleSort}
          />
        }
      >
        {sortedRows.map((r) => {
          const l = r.latest;
          const a = r.activity;
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
                {/* Title links to the repo's STORED report (server-rendered permalink, no re-scan) —
                    not /report?repo= which kicks off the live scan flow. Only linked once there's a
                    persisted scan to show; a never-scanned repo renders inert (its permalink would be a
                    cold-scan confirm gate, not a report) and is reached via the row's ↻ Rescan button. */}
                {l ? (
                  <Link
                    href={`/report/${r.fullName}`}
                    title={`View ${r.fullName}'s latest report`}
                    className="font-mono text-sm text-white hover:text-accent"
                  >
                    {r.fullName}
                  </Link>
                ) : (
                  <span title={`${r.fullName} — not scanned yet`} className="font-mono text-sm text-slate-400">
                    {r.fullName}
                  </span>
                )}
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
                <TechBadges stack={r.techStack} />
              </td>
              <td className="px-3 py-2">
                {l && rlc ? <span className={`font-mono text-sm ${rlc.text}`}>{l.level}</span> : <span className="text-slate-600">—</span>}
              </td>
              {/* Commits — trailing weekly sparkline + total over the ~1-month window (real, from GitHub
                  commit_activity). The number is the period total, matching the column's sort key. */}
              <td className="px-3 py-2">
                {a && a.commitsWeekly.length > 0 ? (
                  <span className="flex items-center gap-2">
                    <Sparkline values={a.commitsWeekly} ariaLabel={`${r.name} weekly commits, past ${a.commitsWeekly.length} weeks`} />
                    <span
                      className="font-mono text-sm tabular-nums text-slate-400"
                      title={`${sum(a.commitsWeekly).toLocaleString()} commits over the past ${a.commitsWeekly.length} weeks (from GitHub)`}
                    >
                      {sum(a.commitsWeekly).toLocaleString()}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              {/* PRs — merged across the analyzed window (repo-wide total in the tooltip). */}
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                {a ? <span title={`${a.prsTotal.toLocaleString()} total PRs`}>{a.prsMerged.toLocaleString()}</span> : "—"}
              </td>
              {/* LoC Δ — lines changed (additions + deletions) across the analyzed PR window. */}
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                {a && a.locChanged > 0 ? <span title={`${a.locChanged.toLocaleString()} lines changed`}>{fmtCompact(a.locChanged)}</span> : "—"}
              </td>
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
            aria-label="Add selected repos to segment"
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
