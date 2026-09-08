"use client";

// The three row renderers for the recall surface, extracted so the panel stays an orchestrator.
//
// THE RULE THIS FILE ENCODES: a packed row and an omitted row are rendered by the SAME component, with
// the same score, the same factor bar and the same age typeset the same way. The only difference is a
// muted treatment and the reason it lost. Showing the winners richly and the losers as a bare count is
// how a ranking stops being auditable — you can no longer see the near-miss that should have made it.
//
// An INELIGIBLE row carries its reason's `VizState` as a real swatch rather than as a phrase, so
// "replaced by a correction" reads as struck-through and "excluded by your filter" reads as a hatch
// that prints no score — because there is no score: filtering happens before scoring.

import { StateSwatch, WhyChip } from "@/components/org/viz";
import type { VizState } from "@/components/org/viz";
import { memoryKindLabel } from "@/lib/org/memory-kinds";
import { RecallContribution } from "@/features/shared/memory/RecallContribution";
import { INELIGIBLE_STATE } from "@/features/shared/memory/recallOmissions";
import {
  INELIGIBLE_COPY,
  type IneligibleMemoryRow,
  type ScoredMemoryRow,
} from "@/features/shared/memory/memoryRecall";

const EXCERPT = 260;

const excerpt = (s: string) => (s.length > EXCERPT ? `${s.slice(0, EXCERPT)}…` : s);

/** Days → a compact human age. The NUMBER is the server's `ageDays`; this only formats it. */
function ageLabel(ageDays: number): string {
  if (ageDays < 1) return "today";
  if (ageDays < 45) return `${Math.round(ageDays)}d`;
  return `${(ageDays / 30.44).toFixed(1)}mo`;
}

export function ScoredRow({ item, muted = false }: { item: ScoredMemoryRow; muted?: boolean }) {
  return (
    <li className={`py-2 ${muted ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 type-body-sm text-slate-300">{excerpt(item.content)}</p>
        <div className="flex shrink-0 items-center gap-2">
          {/* WHY it ranked here — trust · freshness · delivery, drawn per row. */}
          <RecallContribution
            confidence={item.confidence}
            ageDays={item.ageDays}
            kind={item.kind}
            accessCount={item.accessCount}
          />
          {/* Score and age come straight from the response — never recomputed here. */}
          <span className="type-caption tabular-nums text-slate-500" title="Recall score">
            {item.score.toFixed(3)}
          </span>
        </div>
      </div>
      <p className="mt-0.5 type-caption tabular-nums text-slate-600">
        {memoryKindLabel(item.kind)}
        {item.namespace ? ` · ${item.namespace}` : ""} · {ageLabel(item.ageDays)} old · conf{" "}
        {item.confidence.toFixed(2)} · {item.accessCount} recall{item.accessCount === 1 ? "" : "s"} ·{" "}
        {item.content.length} chars
      </p>
    </li>
  );
}

export function IneligibleRow({ item }: { item: IneligibleMemoryRow }) {
  const state = INELIGIBLE_STATE[item.reason];
  return (
    <li className="py-2 opacity-60">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <StateSwatch state={state} size={12} />
        </span>
        <p className={`min-w-0 type-body-sm text-slate-400 ${state === "superseded" ? "line-through decoration-slate-600" : ""}`}>
          {excerpt(item.content)}
        </p>
      </div>
      <p className="mt-0.5 pl-[1.125rem] type-caption text-slate-600">
        {memoryKindLabel(item.kind)}
        {item.namespace ? ` · ${item.namespace}` : ""} · {INELIGIBLE_COPY[item.reason]}
      </p>
    </li>
  );
}

/** A collapsed section for the things that did NOT make it — open by default is too loud, hidden is a lie. */
export function OmissionGroup({
  title,
  hint,
  state,
  count,
  children,
}: {
  title: string;
  /** The one demoted sentence. It rides a WhyChip now: on demand, never above the group. */
  hint: string;
  /** The group's epistemic state, shown as the real swatch beside the summary. */
  state: VizState;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="mt-3 border-t border-divider pt-3">
      <summary className="flex cursor-pointer items-center gap-1.5 type-caption text-slate-500 hover:text-slate-300">
        <StateSwatch state={state} size={12} />
        <span>
          {count} {title}
        </span>
      </summary>
      <div className="mt-1 flex items-center gap-1.5">
        <WhyChip hint={hint} state={state} label={title} />
        <span className="type-caption text-slate-600">why these are here</span>
      </div>
      <ul className="mt-1 divide-y divide-divider">{children}</ul>
    </details>
  );
}
