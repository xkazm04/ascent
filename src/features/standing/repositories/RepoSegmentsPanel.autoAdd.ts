"use client";

// "Every repo of this language / this team belongs to this segment" — state + handler.
//
// This used to be a ONE-SHOT: it filtered the browser's own props, POSTed the matching fullNames to the
// bulk-tag endpoint and persisted nothing about the intent, so the segment became a frozen photograph of
// a predicate the server had never seen. It now DECLARES the rule on the segment and applies it once, so
// the same gesture still ends in tagged repos and the segment can be converged again later (the drift
// line + Apply control on each segment card). The rows it creates are rule-OWNED, which is what lets a
// later apply reap them without ever touching a hand-made tag.

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { RepoItem, SegmentItem } from "./RepoSegmentsPanel";

export function useAutoAdd({
  slug,
  repos,
  membership,
  setMembership,
  setSegments,
  setError,
}: {
  slug: string;
  repos: RepoItem[];
  membership: Record<string, string[]>;
  setMembership: Dispatch<SetStateAction<Record<string, string[]>>>;
  setSegments: Dispatch<SetStateAction<SegmentItem[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  // Auto-add-by-language control.
  const [autoMode, setAutoMode] = useState<"language" | "team">(
    repos.some((r) => r.language) ? "language" : "team",
  );
  const [autoLang, setAutoLang] = useState("");
  const [autoSeg, setAutoSeg] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);

  // Distinct primary languages present in the fleet, with repo counts — the auto-add picker options.
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [repos]);

  const teams = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) for (const team of new Set(r.teams ?? [])) counts.set(team, (counts.get(team) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [repos]);

  // Declare the rule on the chosen segment and converge it once.
  async function declareAndApply(segmentId: string, kind: "language" | "team", value: string): Promise<number> {
    const res = await fetch(`/api/org/segments/${segmentId}/rule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: slug, kind, values: [value] }),
    });
    const data = (await res.json().catch(() => ({}))) as { added?: number; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Bulk add failed.");
    return data.added ?? 0;
  }

  // Auto-add every repo of the chosen language to the chosen segment, in one declared+applied call.
  async function autoAdd() {
    if (!autoLang || !autoSeg) return;
    const matched = repos.filter((r) => autoMode === "team" ? r.teams?.includes(autoLang) : r.language === autoLang).map((r) => r.fullName);
    if (matched.length === 0) return;
    setAutoBusy(true);
    setError(null);
    // Optimistic: tag every matched repo + bump the segment count by the ones not already members.
    // Track exactly which repos we newly tagged so a failed bulkTagRepos (403 for a viewer, P2002, a
    // network drop) can be reverted precisely — previously the catch only set `error` and left the chips
    // + repoCount claiming memberships the server never stored, corrupting the Overview filter and the
    // segment comparison until a manual refresh (toggle()/removeSegment() already roll back; this didn't).
    const addedRepos = matched.filter((fn) => !(membership[fn] ?? []).includes(autoSeg));
    setMembership((m) => {
      const next = { ...m };
      for (const fn of matched) {
        const ids = new Set(next[fn] ?? []);
        ids.add(autoSeg);
        next[fn] = [...ids];
      }
      return next;
    });
    setSegments((s) => s.map((x) => (x.id === autoSeg ? { ...x, repoCount: x.repoCount + addedRepos.length } : x)));
    try {
      const changed = await declareAndApply(autoSeg, autoMode, autoLang);
      // Reconcile the optimistic count with the SERVER's authoritative result. We bumped repoCount by
      // addedRepos.length (what the CLIENT believed was new), but the server only created `changed`
      // membership rows — fewer when the server's taggable universe disagrees with this render's props
      // or some matches were already tagged server-side. Trusting the client count leaves the chip permanently OVERSTATING the
      // segment (and skews the "N repos" summary + Overview). Correct by the delta so the visible count
      // matches what actually persisted.
      if (changed !== addedRepos.length) {
        setSegments((s) =>
          s.map((x) => (x.id === autoSeg ? { ...x, repoCount: Math.max(0, x.repoCount + (changed - addedRepos.length)) } : x)),
        );
      }
    } catch (e) {
      // Undo only the memberships THIS call added (functional updaters, so a concurrent toggle of an
      // unrelated repo isn't clobbered) and back out the count bump.
      setMembership((m) => {
        const next = { ...m };
        for (const fn of addedRepos) next[fn] = (next[fn] ?? []).filter((id) => id !== autoSeg);
        return next;
      });
      setSegments((s) => s.map((x) => (x.id === autoSeg ? { ...x, repoCount: Math.max(0, x.repoCount - addedRepos.length) } : x)));
      setError(e instanceof Error ? e.message : "Bulk add failed.");
    } finally {
      setAutoBusy(false);
    }
  }

  return { autoMode, setAutoMode, autoLang, setAutoLang, autoSeg, setAutoSeg, autoBusy, languages, teams, autoAdd };
}
