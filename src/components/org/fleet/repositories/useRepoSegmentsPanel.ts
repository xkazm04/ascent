"use client";

// State + handlers for RepoSegmentsPanel — extracted so the component's own JSX stays under the
// 200-LOC cap (AGENTS.md). Owns no JSX.

import { useMemo, useState } from "react";
import { useAutoAdd } from "./RepoSegmentsPanel.autoAdd";
import { PALETTE } from "./RepoSegmentsPanel.parts";
import type { SegmentItem, RepoItem } from "./RepoSegmentsPanel";

export function useRepoSegmentsPanel({
  slug,
  repos,
  initialSegments,
  initialMembership,
}: {
  slug: string;
  repos: RepoItem[];
  initialSegments: SegmentItem[];
  initialMembership: Record<string, string[]>;
}) {
  const [segments, setSegments] = useState<SegmentItem[]>(initialSegments);
  const [membership, setMembership] = useState<Record<string, string[]>>(initialMembership);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0] ?? "#3b9eff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The `×` only REQUESTS deletion; the destructive call runs after an explicit confirm. It sits one
  // pixel from the ✎ edit control, and deleting a segment also wipes every RepoSegment tag on it —
  // which drives the Overview filter and segment comparison. A single misclick was irreversible.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = segments.find((s) => s.id === pendingDeleteId) ?? null;
  const [filter, setFilter] = useState("");
  // Inline chip editor (rename + recolor) — one segment at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  // Auto-add-by-language state + handler (extracted to RepoSegmentsPanel.autoAdd.ts).
  const { autoLang, setAutoLang, autoSeg, setAutoSeg, autoBusy, languages, autoAdd } = useAutoAdd({
    slug,
    repos,
    membership,
    setMembership,
    setSegments,
    setError,
  });
  const visibleRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  async function createSegment() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, name: n, color }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Failed to create segment.");
      setSegments((s) => [{ id: data.id!, name: n, color, repoCount: 0 }, ...s]);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSegment(id: string) {
    // Snapshot for rollback: DELETE is admin-gated (requireOrgRole "admin"), so a member's 403 (or any
    // failure) must NOT leave the chip "deleted" only to resurrect on the next refresh / Overview read.
    // Optimistically drop it, then restore + surface the reason if the server didn't actually delete it.
    const prevSegments = segments;
    const prevMembership = membership;
    setError(null);
    setSegments((s) => s.filter((x) => x.id !== id));
    setMembership((m) => {
      const next: Record<string, string[]> = {};
      for (const [fn, ids] of Object.entries(m)) next[fn] = ids.filter((x) => x !== id);
      return next;
    });
    const res = await fetch(`/api/org/segments/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setSegments(prevSegments);
      setMembership(prevMembership);
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't delete the segment (admins only).");
    }
  }

  async function toggle(fullName: string, segId: string) {
    const current = membership[fullName] ?? [];
    const member = !current.includes(segId);
    // Optimistic: flip the chip + adjust the segment's repo count. Derive the actual flip from the
    // functional updater's `prev` and only adjust the count when membership genuinely changed —
    // otherwise two fast clicks both read stale closure state, both see member=true, and each bumps
    // repoCount (+2) while the Set holds the id once, leaving the count permanently off by one.
    let flipped = false;
    setMembership((m) => {
      const ids = new Set(m[fullName] ?? []);
      flipped = member ? !ids.has(segId) : ids.has(segId);
      if (member) ids.add(segId);
      else ids.delete(segId);
      return { ...m, [fullName]: [...ids] };
    });
    if (flipped) {
      setSegments((s) => s.map((x) => (x.id === segId ? { ...x, repoCount: Math.max(0, x.repoCount + (member ? 1 : -1)) } : x)));
    }
    setError(null);
    // Was fire-and-forget (.catch(()=>{})), so a 404/permission/network failure left the chip + repo-
    // count showing a membership that doesn't exist server-side (and fed the Overview filter). Inspect
    // the result and UNDO exactly this toggle (functional updaters, so a concurrent toggle of another
    // repo isn't clobbered) when it didn't persist.
    const res = await fetch(`/api/org/segments/${segId}/repos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: slug, fullName, member }),
    }).catch(() => null);
    if (!res || !res.ok) {
      // Only undo the parts we actually applied: if the optimistic flip was a no-op (a duplicate
      // in-flight click), reverting membership/count here would over-correct.
      if (flipped) {
        setMembership((m) => {
          const ids = new Set(m[fullName] ?? []);
          if (member) ids.delete(segId);
          else ids.add(segId);
          return { ...m, [fullName]: [...ids] };
        });
        setSegments((s) => s.map((x) => (x.id === segId ? { ...x, repoCount: Math.max(0, x.repoCount + (member ? -1 : 1)) } : x)));
      }
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't update the tag.");
    }
  }

  function startEdit(s: SegmentItem) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditColor(s.color);
    setError(null);
  }

  // Commit a rename + recolor in one PATCH. A blank name keeps the old one (recolor-only edits).
  async function saveEdit(id: string) {
    const next = editName.trim();
    // Snapshot the prior name/color so a failed PATCH (403 for a viewer, validation reject, network drop)
    // can be rolled back — otherwise the chip kept showing the new name/color the server never stored,
    // i.e. phantom state until a manual refresh (the same hole toggle()/removeSegment() already close).
    const prev = segments.find((x) => x.id === id);
    const prevName = prev?.name;
    const prevColor = prev?.color;
    setSegments((s) => s.map((x) => (x.id === id ? { ...x, name: next || x.name, color: editColor } : x)));
    setEditingId(null);
    setError(null);
    const res = await fetch(`/api/org/segments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(next ? { name: next } : {}), color: editColor }),
    }).catch(() => null);
    if (!res || !res.ok) {
      // Restore just this segment with a functional updater so a concurrent edit to another isn't clobbered.
      setSegments((s) => s.map((x) => (x.id === id ? { ...x, name: prevName ?? x.name, color: prevColor ?? x.color } : x)));
      setError((await res?.json().catch(() => ({})))?.error ?? "Failed to update segment.");
    }
  }

  return {
    segments,
    membership,
    name,
    setName,
    color,
    setColor,
    busy,
    error,
    pendingDelete,
    setPendingDeleteId,
    filter,
    setFilter,
    editingId,
    setEditingId,
    editName,
    setEditName,
    editColor,
    setEditColor,
    autoLang,
    setAutoLang,
    autoSeg,
    setAutoSeg,
    autoBusy,
    languages,
    autoAdd,
    visibleRepos,
    createSegment,
    removeSegment,
    toggle,
    startEdit,
    saveEdit,
  };
}
