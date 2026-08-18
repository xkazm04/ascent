"use client";

// One proposed rollup: the summary the model wrote, the evidence for trusting it (cohesion, confidence),
// and — the part that must never be collapsed — the FULL LIST of memories that applying it would
// supersede. A proposal card that showed only the summary would be asking for consent to retire things
// the reader can't see.

import { memoryKindLabel } from "@/lib/org/memory-kinds";
import type { ReflectProposal } from "@/features/shared/memory/memoryReflect";

const EXCERPT = 220;

export function MemoryReflectProposal({
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

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
      <p className="text-sm text-slate-200">{summaryContent}</p>

      <p className="mt-1.5 font-mono text-xs tabular-nums text-slate-500">
        {memberIds.length} member{memberIds.length === 1 ? "" : "s"} · cohesion {cohesion.toFixed(2)} ·
        confidence {confidence.toFixed(2)}
        <span className="ml-1 text-slate-600">
          (capped at the most certain memory it consolidates)
        </span>
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-xs text-slate-500 hover:text-slate-300">
          would supersede {memberIds.length} memor{memberIds.length === 1 ? "y" : "ies"}
        </summary>
        <ul className="mt-2 space-y-1.5 border-l border-divider pl-3">
          {members.map((m) => (
            <li key={m.id}>
              <span className="font-mono text-xs text-slate-600">{memoryKindLabel(m.kind)}</span>{" "}
              <span className="text-sm text-slate-400">
                {m.content.length > EXCERPT ? `${m.content.slice(0, EXCERPT)}…` : m.content}
              </span>
            </li>
          ))}
          {members.length < memberIds.length && (
            // The join happens server-side against the same working set; a gap means a row moved
            // underneath us. Say so rather than silently listing fewer memories than we'd retire.
            <li className="text-sm text-orange-300">
              {memberIds.length - members.length} member row(s) could not be shown. Re-run the pass
              before applying.
            </li>
          )}
        </ul>
      </details>

      <div className="mt-2 flex justify-end">
        {applied ? (
          <span className="font-mono text-xs text-emerald-300">applied</span>
        ) : (
          <button
            onClick={onApply}
            disabled={applying || members.length < memberIds.length}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
            title="Write this summary and supersede its members. Nothing is deleted."
          >
            {applying ? "Applying…" : "Apply rollup"}
          </button>
        )}
      </div>
    </div>
  );
}
