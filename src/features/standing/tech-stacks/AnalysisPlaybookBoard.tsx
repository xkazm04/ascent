"use client";

// Combined variant A — "Playbook board". One unified board (no separate consensus + transfer cards):
// every dimension is a diagnosis row, and each actionable one (divergent / gap) expands in place to
// reveal its transformation playbook — steps, proposed artifact, adoption checklist. Diagnosis stays
// primary and always visible; the prescription unfolds on demand. Mental model: a diagnostic board
// where each gap opens its plan. Client (expand state); consumes the computed insights as props.

import { useState } from "react";
import { ConsensusRow } from "@/features/standing/tech-stacks/analysisShared";
import { PlaybookDetail } from "@/features/standing/tech-stacks/PlaybookDetail";
import type { DimInsight } from "@/features/standing/tech-stacks/fleetAnalysis";
import type { AnalysisScope } from "@/features/standing/tech-stacks/analysisScope";

const isActionable = (d: DimInsight) => d.klass === "divergent" || d.klass === "gap";

export function AnalysisPlaybookBoard({ org, dims, scope }: { org: string; dims: DimInsight[]; scope: AnalysisScope }) {
  const firstActionable = dims.find(isActionable)?.dimId;
  const [open, setOpen] = useState<Set<string>>(() => new Set(firstActionable ? [firstActionable] : []));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="divide-y divide-divider">
      {dims.map((d) => {
        const actionable = isActionable(d);
        const isOpen = open.has(d.dimId);
        return (
          <ConsensusRow
            key={d.dimId}
            d={d}
            nounPlural={scope.nounPlural}
            action={
              actionable ? (
                <button
                  type="button"
                  onClick={() => toggle(d.dimId)}
                  aria-expanded={isOpen}
                  className="focus-ring font-mono text-xs text-accent transition hover:text-white"
                >
                  {isOpen ? "hide plan ▾" : "view plan ▸"}
                </button>
              ) : undefined
            }
          >
            {actionable && isOpen && (
              <div className="mt-3 rounded-xl border border-divider bg-surface/30 p-4">
                <PlaybookDetail org={org} d={d} scope={scope} />
              </div>
            )}
          </ConsensusRow>
        );
      })}
    </div>
  );
}
