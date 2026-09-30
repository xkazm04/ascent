"use client";

// One proposed rollup. Members are marked superseded (kept, not deleted). The summary is current
// until a person applies it, then reached. Nothing is written by the proposal itself.
import { Caption, CellMark, GhostAction, HairlineList, Ladder, ListRow, Panel } from "@/components/kit";
import { memoryKindLabel } from "@/lib/org/memory-kinds";
import type { ReflectProposal } from "./memoryReflect";
import { excerpt } from "./memoryView";
import { MemoryNote } from "./MemoryNote";

export function MemoryReflectProposalV2({
  proposal,
  applied,
  applying,
  onApply,
}: {
  proposal: ReflectProposal;
  applied: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const { summaryContent, members, memberIds, cohesion, confidence } = proposal;
  const gap = memberIds.length - members.length;
  return (
    <Panel pad="sm" aria-label="Consolidation proposal">
      <Ladder
        label="Consolidation"
        steps={[
          { key: "members", label: `${memberIds.length} members`, state: "open", detail: "superseded on apply, not deleted" },
          { key: "summary", label: "Summary", state: applied ? "reached" : "current", detail: applied ? "written" : "proposed, not written" },
        ]}
      />
      <p className="mt-3 type-body-sm text-slate-200">{summaryContent}</p>
      <Caption className="mt-2">
        {memberIds.length} member{memberIds.length === 1 ? "" : "s"}, cohesion {cohesion.toFixed(2)}, confidence {confidence.toFixed(2)}. Capped at the most certain memory it consolidates.
      </Caption>
      <details className="mt-3">
        <summary className="cursor-pointer type-body-sm text-slate-400">
          would supersede {memberIds.length} memor{memberIds.length === 1 ? "y" : "ies"}
        </summary>
        <HairlineList className="mt-2">
          {members.map((m) => (
            <ListRow
              key={m.id}
              title={excerpt(m.content)}
              detail={<CellMark state="missing">{memoryKindLabel(m.kind)}, would supersede</CellMark>}
            />
          ))}
        </HairlineList>
        {gap > 0 && (
          <MemoryNote kind="risk">
            {gap} member row(s) could not be shown. Re-run the pass before applying.
          </MemoryNote>
        )}
      </details>
      <div className="mt-3 flex justify-end">
        {applied ? (
          <CellMark state="met">applied</CellMark>
        ) : (
          <GhostAction onClick={onApply} disabled={applying || gap > 0}>
            {applying ? "Applying…" : "Apply rollup"}
          </GhostAction>
        )}
      </div>
    </Panel>
  );
}
