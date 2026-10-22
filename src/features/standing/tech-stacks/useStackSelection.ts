"use client";

// The tech-stacks selection: which stacks are plotted AND in scope for the analysis below. ONE hook both
// compositions (TechStacksAnalysis) calls, so the radar rail and the diagnosis board always agree.

import { useState } from "react";
import type { SegmentSummary } from "@/lib/db";

export function useStackSelection(stacks: SegmentSummary[]) {
  // Default to the whole set: the selection drives the analysis, so a complete picture (every
  // divergence, including the laggards) reads on load; narrow it to focus.
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

  return { active, hovered, setHovered, toggle, toggleAll, allActive, activeStacks };
}
