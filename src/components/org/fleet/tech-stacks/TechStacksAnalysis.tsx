"use client";

// Combines the tech-stacks "Profiles" radar and the "Dimension analysis" into ONE section around a
// single stack selection: toggling a stack in the radar rail (or select/deselect-all) also scopes the
// diagnosis tiles, consensus board, and transformation playbooks below — so the analysis always
// reflects the exact set of stacks the user is looking at. Owns the selection state; the profiles
// panel is controlled, and the analysis recomputes over the selected stacks (computeFleetInsights is
// pure). Client component; the page passes the server-fetched summaries in.

import { useState } from "react";
import { StackProfiles } from "@/components/org/fleet/tech-stacks/StackProfiles";
import { StackInsights } from "@/components/org/fleet/tech-stacks/StackInsights";
import { STACK_SCOPE } from "@/components/org/fleet/tech-stacks/analysisScope";
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
        <p className="text-sm text-slate-500">
          Dimension analysis of the{" "}
          <span className="font-medium text-slate-300">{activeStacks.length}</span> selected{" "}
          {activeStacks.length === 1 ? "stack" : "stacks"} — toggle stacks above to focus the diagnosis and playbooks.
        </p>
        <StackInsights org={org} stacks={activeStacks} fleet={fleet} dims={dims} scope={STACK_SCOPE} />
      </div>
    </div>
  );
}
