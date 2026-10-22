"use client";

// The playbook board, Prism composition: every dimension is a ruled diagnosis row, and each actionable one
// (divergent / gap) opens its transformation playbook in place. Same expand rule and the same first-open
// default as AnalysisPlaybookBoard; only the row and the playbook are drawn from the v2 parts.
import { useState } from "react";
import { HairlineList } from "@/components/kit";
import { ConsensusRowV2 } from "./analysisShared.v2";
import { PlaybookDetailV2 } from "./PlaybookDetail.v2";
import type { DimInsight } from "./fleetAnalysis";
import type { AnalysisScope } from "./analysisScope";

const isActionable = (d: DimInsight) => d.klass === "divergent" || d.klass === "gap";

export function AnalysisPlaybookBoardV2({ org, dims, scope }: { org: string; dims: DimInsight[]; scope: AnalysisScope }) {
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
    <HairlineList as="div">
      {dims.map((d) => {
        const actionable = isActionable(d);
        const isOpen = open.has(d.dimId);
        return (
          <ConsensusRowV2
            key={d.dimId}
            d={d}
            nounPlural={scope.nounPlural}
            action={
              actionable ? (
                <button type="button" onClick={() => toggle(d.dimId)} aria-expanded={isOpen} className="focus-ring type-caption text-accent transition hover:text-white">
                  {isOpen ? "hide plan ▾" : "view plan ▸"}
                </button>
              ) : undefined
            }
          >
            {actionable && isOpen && (
              <div className="mt-4 border-l-2 border-divider pl-5">
                <PlaybookDetailV2 org={org} d={d} scope={scope} />
              </div>
            )}
          </ConsensusRowV2>
        );
      })}
    </HairlineList>
  );
}
