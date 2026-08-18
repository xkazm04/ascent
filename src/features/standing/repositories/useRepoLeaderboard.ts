"use client";

// Selection + sort + bulk-tag state for RepoLeaderboard — extracted so the component's own JSX stays
// under the 200-LOC cap (AGENTS.md). Owns no JSX.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityValue, type SortKey, type SortState } from "./RepoLeaderboardParts";
import { bulkTagRepos } from "@/lib/org/segment-actions";

export interface LeaderRow {
  fullName: string;
  name: string;
  watched: boolean;
  scanSchedule: string;
  lastScanStatus: string | null;
  lastScanError: string | null;
  aiConformance: number | null;
  techStack?: import("@/lib/types").TechStack | null;
  activity: import("./RepoLeaderboardParts").RepoActivity | null;
  // `latest` is kept only to gate the report link (link a scanned repo, render inert otherwise) — the
  // Overall/Adopt/Rigor/Posture columns it fed were dropped in favour of the activity columns.
  latest: { level: string; overall: number; adoption: number; rigor: number; posture: string; scannedAt: string } | null;
}

export interface SegmentItem {
  id: string;
  name: string;
}

export function useRepoLeaderboard({ slug, rows, segments }: { slug: string; rows: LeaderRow[]; segments: SegmentItem[] }) {
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

  return {
    sort,
    cycleSort,
    sortedRows,
    selected,
    allSelected,
    target,
    setTarget,
    busy,
    done,
    error,
    toggle,
    toggleAll,
    addToSegment,
    clearSelected: () => setSelected(new Set()),
  };
}
