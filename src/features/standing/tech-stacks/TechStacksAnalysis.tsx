"use client";

// Combines the tech-stacks "Profiles" radar and the "Dimension analysis" into ONE section around a
// single stack selection: toggling a stack in the radar rail (or select/deselect-all) also scopes the
// diagnosis tiles, consensus board, and transformation playbooks below — so the analysis always
// reflects the exact set of stacks the user is looking at. Owns the selection state; the profiles
// panel is controlled, and the analysis recomputes over the selected stacks (computeFleetInsights is
// pure). Client component; the page passes the server-fetched summaries in.

import { useState } from "react";
import { WhyChip } from "@/components/org/viz";
import { StackProfiles } from "@/features/standing/tech-stacks/StackProfiles";
import { StackInsights } from "@/features/standing/tech-stacks/StackInsights";
import { STACK_SCOPE } from "@/features/standing/tech-stacks/analysisScope";
import type { SegmentSummary } from "@/lib/db";

export function TechStacksAnalysis({ org, stacks, fleet, dims }: {
  org: string;
  stacks: SegmentSummary[];
  fleet: SegmentSummary | null;
  dims: string[];
}) {
  // Default to the whole set — the selection now drives the analysis, so a complete picture (every
  // divergence, including the laggards') reads on load; narrow it to focus.
  const [active, setActive] = useState<Set<string>>(() => new Set(stacks.map((s) => s.id ?? "")));
  const [hovered, setHovered] = useState<string | null>(null);

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allActive = active.size === stacks.length;
  const toggleAll = () => setActive(allActive ? new Set() : new Set(stacks.map((s) => s.id ?? "")));

  const activeStacks = stacks.filter((s) => active.has(s.id ?? ""));

  return (
    <div className="space-y-6">
      <StackProfiles
        org={org}
        stacks={stacks}
        dims={dims}
        scope={STACK_SCOPE}
        active={active}
        allActive={allActive}
        hovered={hovered}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onHover={setHovered}
      />
      <div>
        {/* The scope readout is data (how much of the fleet the verdicts below rest on); the
            instruction that used to follow it — "toggle stacks above to focus the diagnosis and
            playbooks" — is the coupling between two panels, so it moved into the WhyChip beside it. */}
        <div className="flex items-center gap-1.5 type-mono-sm text-slate-500">
          <span className="tabular-nums text-slate-300">{activeStacks.length}</span>
          <span>of {stacks.length} stacks in scope</span>
          <WhyChip
            label="analysis scope"
            hint="Toggling a stack in the rail above rescopes every diagnosis, verdict and playbook below it — the selection drives both panels."
          />
        </div>
        <StackInsights org={org} stacks={activeStacks} fleet={fleet} dims={dims} scope={STACK_SCOPE} />
      </div>
    </div>
  );
}
