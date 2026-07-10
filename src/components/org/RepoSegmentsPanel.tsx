"use client";

// The segment manager on the Repositories tab. Create named segments (platform, mobile, legacy,
// acquisitions), recolor/remove them, and tag each repo into any number of them. Tagging is
// optimistic — the chip flips immediately and the POST reconciles in the background. The tags drive
// the Overview's segment filter and the segment-vs-segment comparison; all state lives server-side
// (RepoSegment), so this panel only mirrors it.

import { useMemo, useState } from "react";
import { ConfirmAction, segmentDeleteConfirm } from "@/components/ConfirmAction";
import { Card, SectionHeader } from "@/components/org/ui";
import { bulkTagRepos } from "@/lib/org/segment-actions";
import {
  PALETTE,
  SegmentChips,
  SegmentEditor,
  AutoAddRow,
  CreateSegmentRow,
  RepoTaggingList,
} from "./RepoSegmentsPanel.parts";

export interface SegmentItem {
  id: string;
  name: string;
  color: string;
  repoCount: number;
}
export interface RepoItem {
  fullName: string;
  name: string;
  /** GitHub's detected primary language (null when unknown) — feeds auto-add-by-language. */
  language?: string | null;
}

export function RepoSegmentsPanel({
  slug,
  repos,
  segments: initialSegments,
  membership: initialMembership,
}: {
  slug: string;
  repos: RepoItem[];
  segments: SegmentItem[];
  membership: Record<string, string[]>; // fullName -> segmentIds
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
  // Auto-add-by-language control.
  const [autoLang, setAutoLang] = useState("");
  const [autoSeg, setAutoSeg] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);

  // Distinct primary languages present in the fleet, with repo counts — the auto-add picker options.
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [repos]);
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

  // Auto-add every repo of the chosen language to the chosen segment, in one bulk call.
  async function autoAdd() {
    if (!autoLang || !autoSeg) return;
    const matched = repos.filter((r) => r.language === autoLang).map((r) => r.fullName);
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
      const changed = await bulkTagRepos(autoSeg, { org: slug, fullNames: matched, member: true });
      // Reconcile the optimistic count with the SERVER's authoritative result. We bumped repoCount by
      // addedRepos.length (what the CLIENT believed was new), but the server only created `changed`
      // membership rows — fewer when some matched repos aren't the org's (an unknown fullName) or were
      // already tagged server-side. Trusting the client count leaves the chip permanently OVERSTATING the
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

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Segments"
        description="Group repos into named slices (platform, mobile, legacy…). Tags scope the Overview filter and power segment-vs-segment comparison."
      />

      {/* Existing segments + create */}
      <SegmentChips segments={segments} startEdit={startEdit} onDeleteRequest={setPendingDeleteId} />

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect runs. */}
      <ConfirmAction
        open={pendingDelete != null}
        busy={busy}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          if (id) void removeSegment(id);
        }}
        {...(pendingDelete
          ? segmentDeleteConfirm(pendingDelete.name, pendingDelete.repoCount)
          : { title: "", body: "", confirmLabel: "", tone: "danger" as const })}
      />

      {/* Inline editor — rename + recolor the selected segment (PATCH /api/org/segments/:id). */}
      {editingId && (
        <SegmentEditor
          editingId={editingId}
          editName={editName}
          setEditName={setEditName}
          editColor={editColor}
          setEditColor={setEditColor}
          saveEdit={saveEdit}
          setEditingId={setEditingId}
        />
      )}

      {/* Auto-add by language — bulk-tag every repo of a language into a segment in one call. */}
      {segments.length > 0 && languages.length > 0 && (
        <AutoAddRow
          languages={languages}
          segments={segments}
          autoLang={autoLang}
          setAutoLang={setAutoLang}
          autoSeg={autoSeg}
          setAutoSeg={setAutoSeg}
          autoBusy={autoBusy}
          autoAdd={autoAdd}
        />
      )}

      <CreateSegmentRow color={color} setColor={setColor} name={name} setName={setName} createSegment={createSegment} busy={busy} />
      {error && <p role="alert" aria-live="polite" className="mt-2 text-sm text-orange-300">{error}</p>}

      {/* Per-repo tagging */}
      {segments.length > 0 && (
        <RepoTaggingList
          segments={segments}
          visibleRepos={visibleRepos}
          membership={membership}
          filter={filter}
          setFilter={setFilter}
          toggle={toggle}
          repos={repos}
        />
      )}
    </Card>
  );
}
