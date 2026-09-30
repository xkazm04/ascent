"use client";

// Existing segments on the Prism manager: name, tagged count, edit, delete request.
import { Caption, GhostAction } from "@/components/kit";
import type { SegmentItem } from "./RepoSegmentsPanel";
import { TAGGED_COUNT_HINT, taggedScoredLabel } from "./segmentCounts";

export function SegmentChipsV2({
  segments,
  startEdit,
  onDeleteRequest,
}: {
  segments: SegmentItem[];
  startEdit: (s: SegmentItem) => void;
  onDeleteRequest: (id: string) => void;
}) {
  if (segments.length === 0) {
    return <Caption className="mt-4">No segments yet. Create one to start tagging.</Caption>;
  }
  return (
    <ul className="mt-4 flex flex-wrap items-center gap-2">
      {segments.map((s) => (
        <li key={s.id} className="inline-flex items-center gap-2 border border-divider px-2 py-1">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="type-body-sm text-slate-200" onDoubleClick={() => startEdit(s)} title="Double-click to rename">
            {s.name}
          </span>
          <span className="type-caption text-slate-400" title={TAGGED_COUNT_HINT}>
            {taggedScoredLabel(s.repoCount, null)}
          </span>
          <GhostAction onClick={() => startEdit(s)} aria-label={`Edit ${s.name} segment`} className="px-2 py-1">
            Edit
          </GhostAction>
          <GhostAction onClick={() => onDeleteRequest(s.id)} aria-label={`Delete ${s.name} segment`} className="px-2 py-1">
            Delete
          </GhostAction>
        </li>
      ))}
    </ul>
  );
}
