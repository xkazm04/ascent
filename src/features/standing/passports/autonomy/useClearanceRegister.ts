"use client";

// Filter state for the clearance register: a tier tile and a promotion-plan condition. Both
// compositions read the same derived lists from this hook.
import { useMemo, useState } from "react";
import { tierCounts, type AutonomyTier, type RepoAutonomy } from "./autonomyModel";
import { clearanceBands, clearanceEdge } from "./clearanceLadder";
import type { PlanSelection } from "./PromotionPlan";
import { promotionPlan } from "./promotionPlanModel";

export function useClearanceRegister(repos: RepoAutonomy[]) {
  const [filter, setFilter] = useState<AutonomyTier | null>(null);
  const [condition, setCondition] = useState<PlanSelection | null>(null);
  const counts = useMemo(() => tierCounts(repos), [repos]);
  const plan = useMemo(() => promotionPlan(repos), [repos]);
  const visible = useMemo(
    () => repos.filter((r) => (filter === null || r.tier === filter) && (condition === null || condition.repos.includes(r.fullName))),
    [repos, filter, condition],
  );
  const bands = useMemo(() => clearanceBands(repos), [repos]);
  const edge = useMemo(() => clearanceEdge(repos), [repos]);
  const sorted = useMemo(
    () => [...visible].sort((a, b) => a.tier - b.tier || b.nextProgress - a.nextProgress || a.name.localeCompare(b.name)),
    [visible],
  );
  return { filter, setFilter, condition, setCondition, counts, plan, visible, bands, edge, sorted };
}
