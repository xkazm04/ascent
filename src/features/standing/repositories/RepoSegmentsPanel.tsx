"use client";

// The segment manager on the Repositories tab. Create named segments (platform, mobile, legacy,
// acquisitions), recolor/remove them, and tag each repo into any number of them. Tagging is
// optimistic — the chip flips immediately and the POST reconciles in the background. The tags drive
// the Overview's segment filter and the segment-vs-segment comparison; all state lives server-side
// (RepoSegment), so this panel only mirrors it.
//
// All state + handlers live in useRepoSegmentsPanel.ts (owns no JSX) — this file stays under the
// 200-LOC cap (AGENTS.md) by keeping the JSX itself thin.

import { ConfirmAction, segmentDeleteConfirm } from "@/components/ConfirmAction";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import {
  SegmentChips,
  SegmentEditor,
  AutoAddRow,
  CreateSegmentRow,
} from "./RepoSegmentsPanel.parts";
import { RepoTaggingList } from "./RepoTaggingList";
import { useRepoSegmentsPanel } from "./useRepoSegmentsPanel";

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
  const p = useRepoSegmentsPanel({ slug, repos, initialSegments, initialMembership });

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Segments"
        description="Group repos into named slices (platform, mobile, legacy…). Tags scope the Overview filter and power segment-vs-segment comparison."
      />

      {/* Existing segments + create */}
      <SegmentChips segments={p.segments} startEdit={p.startEdit} onDeleteRequest={p.setPendingDeleteId} />

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect runs. */}
      <ConfirmAction
        open={p.pendingDelete != null}
        busy={p.busy}
        onCancel={() => p.setPendingDeleteId(null)}
        onConfirm={() => {
          const id = p.pendingDelete?.id ?? null;
          p.setPendingDeleteId(null);
          if (id) void p.removeSegment(id);
        }}
        {...(p.pendingDelete
          ? segmentDeleteConfirm(p.pendingDelete.name, p.pendingDelete.repoCount)
          : { title: "", body: "", confirmLabel: "", tone: "danger" as const })}
      />

      {/* Inline editor — rename + recolor the selected segment (PATCH /api/org/segments/:id). */}
      {p.editingId && (
        <SegmentEditor
          editingId={p.editingId}
          editName={p.editName}
          setEditName={p.setEditName}
          editColor={p.editColor}
          setEditColor={p.setEditColor}
          saveEdit={p.saveEdit}
          setEditingId={p.setEditingId}
        />
      )}

      {/* Auto-add by language — bulk-tag every repo of a language into a segment in one call. */}
      {p.segments.length > 0 && p.languages.length > 0 && (
        <AutoAddRow
          languages={p.languages}
          segments={p.segments}
          autoLang={p.autoLang}
          setAutoLang={p.setAutoLang}
          autoSeg={p.autoSeg}
          setAutoSeg={p.setAutoSeg}
          autoBusy={p.autoBusy}
          autoAdd={p.autoAdd}
        />
      )}

      <CreateSegmentRow color={p.color} setColor={p.setColor} name={p.name} setName={p.setName} createSegment={p.createSegment} busy={p.busy} />
      {p.error && <p role="alert" aria-live="polite" className="mt-2 text-sm text-orange-300">{p.error}</p>}

      {/* Per-repo tagging */}
      {p.segments.length > 0 && (
        <RepoTaggingList
          segments={p.segments}
          visibleRepos={p.visibleRepos}
          membership={p.membership}
          filter={p.filter}
          setFilter={p.setFilter}
          toggle={p.toggle}
          repos={repos}
        />
      )}
    </Card>
  );
}
