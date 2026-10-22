"use client";

// Segment manager. Same hook as RepoSegmentsPanel, so create, recolor, delete, and tag cannot drift.
import { ConfirmAction, segmentDeleteConfirm } from "@/components/ConfirmAction";
import { Frame, SectionHead } from "@/components/kit";
import { SegmentChipsView } from "./SegmentChips";
import { AutoAddRowView, CreateSegmentRowView, SegmentEditorView } from "./SegmentForms";
import { RepoTaggingListView } from "./RepoTaggingListView";
import { useRepoSegmentsPanel } from "./useRepoSegmentsPanel";
import type { RepoItem, SegmentItem } from "./RepoSegmentsPanel";

export function RepoSegmentsPanelView({
  slug,
  repos,
  segments: initialSegments,
  membership: initialMembership,
}: {
  slug: string;
  repos: RepoItem[];
  segments: SegmentItem[];
  membership: Record<string, string[]>;
}) {
  const p = useRepoSegmentsPanel({ slug, repos, initialSegments, initialMembership });
  return (
    <Frame edge="top" pad="md" aria-label="Create and tag segments">
      <SectionHead
        eyebrow="Segments"
        title="Create and tag"
        lede="Name a slice, then tag the repositories that belong in it."
      />
      <SegmentChipsView segments={p.segments} startEdit={p.startEdit} onDeleteRequest={p.setPendingDeleteId} />
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
      {p.editingId && (
        <SegmentEditorView
          editingId={p.editingId}
          editName={p.editName}
          setEditName={p.setEditName}
          editColor={p.editColor}
          setEditColor={p.setEditColor}
          saveEdit={p.saveEdit}
          setEditingId={p.setEditingId}
        />
      )}
      {p.segments.length > 0 && (
        <AutoAddRowView
          languages={p.languages}
          teams={p.teams}
          segments={p.segments}
          autoMode={p.autoMode}
          setAutoMode={p.setAutoMode}
          autoLang={p.autoLang}
          setAutoLang={p.setAutoLang}
          autoSeg={p.autoSeg}
          setAutoSeg={p.setAutoSeg}
          autoBusy={p.autoBusy}
          autoAdd={p.autoAdd}
        />
      )}
      <CreateSegmentRowView color={p.color} setColor={p.setColor} name={p.name} setName={p.setName} createSegment={p.createSegment} busy={p.busy} />
      {p.error && (
        <p role="alert" aria-live="polite" className="mt-2 type-body-sm text-slate-100">
          <span aria-hidden>! </span>
          {p.error}
        </p>
      )}
      {p.segments.length > 0 && (
        <RepoTaggingListView
          segments={p.segments}
          visibleRepos={p.visibleRepos}
          membership={p.membership}
          filter={p.filter}
          setFilter={p.setFilter}
          toggle={p.toggle}
          repos={repos}
        />
      )}
    </Frame>
  );
}
