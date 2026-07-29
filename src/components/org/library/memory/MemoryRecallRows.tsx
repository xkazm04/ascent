"use client";

// The three row renderers for the recall surface, extracted so the panel stays an orchestrator.
//
// THE RULE THIS FILE ENCODES: a packed row and an omitted row are rendered by the SAME component, with
// the same score and age typeset the same way. The only difference is a muted treatment and the reason
// it lost. Showing the winners richly and the losers as a bare count is how a ranking stops being
// auditable — you can no longer see the near-miss that should have made it.

import { memoryKindLabel } from "@/lib/org/memory-kinds";
import {
  INELIGIBLE_COPY,
  type IneligibleMemoryRow,
  type ScoredMemoryRow,
} from "@/components/org/library/memory/memoryRecall";

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
        <p className="min-w-0 text-sm text-slate-300">{excerpt(item.content)}</p>
        {/* Score and age come straight from the response — never recomputed here. */}
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500" title="Recall score">
          {item.score.toFixed(3)}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-600">
        {memoryKindLabel(item.kind)}
        {item.namespace ? ` · ${item.namespace}` : ""} · {ageLabel(item.ageDays)} old · conf{" "}
        {item.confidence.toFixed(2)} · {item.accessCount} recall{item.accessCount === 1 ? "" : "s"} ·{" "}
        {item.content.length} chars
      </p>
    </li>
  );
}

export function IneligibleRow({ item }: { item: IneligibleMemoryRow }) {
  return (
    <li className="py-2 opacity-60">
      <p className="min-w-0 text-sm text-slate-400">{excerpt(item.content)}</p>
      <p className="mt-0.5 font-mono text-xs text-slate-600">
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
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="mt-3 border-t border-divider pt-3">
      <summary className="cursor-pointer font-mono text-xs text-slate-500 hover:text-slate-300">
        {count} {title}
      </summary>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
      <ul className="mt-1 divide-y divide-divider">{children}</ul>
    </details>
  );
}
