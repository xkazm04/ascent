"use client";

// VARIANT A — "Clearance registry".
//
// Metaphor: a SECURITY CLEARANCE. The passport stops being a grade and becomes a credential the org
// issues to a repo: this repo is cleared to T1, here is what that permits, here are the conditions
// it was granted on, and here is the countersignature it still needs. Differs from the baseline
// portfolio (scatter + blocker docket + sortable table) by being repo-first and permission-first —
// you read a card the way you'd read a badge, not a chart. Nothing here is a score you compare;
// everything is a permission you either hold or don't.
//
// Two controls narrow the register: the clearance filter across the muster ledger (click a tier tile
// to isolate that cohort) and the promotion plan (click a condition to see the repos it holds back).
// The register itself is still not sorted by merit: a clearance register is read, not ranked. What IS
// ranked is the plan's list of CONDITIONS per transition (PromotionPlan.tsx), because "which one fix
// lifts the most repos" is a fleet question no single card can answer.

import { useMemo, useState } from "react";
import { Kicker, SectionHeading } from "@/components/ui";
import { SectionEmpty, TILE_LEDGER, Tile } from "@/components/org/shared/ui";
import { BandLadder, Legend } from "@/components/org/viz";
import { TIERS, TIER_META, tierHex, tierCounts, type AutonomyTier, type RepoAutonomy } from "./autonomyModel";
import { clearanceBands, clearanceEdge, clearanceStates } from "./clearanceLadder";
import { ClearanceCard } from "./ClearanceCard";
import { PromotionPlan, type PlanSelection } from "./PromotionPlan";
import { promotionPlan } from "./promotionPlanModel";

export function AutonomyClearance({ repos }: { repos: RepoAutonomy[] }) {
  const [filter, setFilter] = useState<AutonomyTier | null>(null);
  const [condition, setCondition] = useState<PlanSelection | null>(null);
  const counts = useMemo(() => tierCounts(repos), [repos]);
  const plan = useMemo(() => promotionPlan(repos), [repos]);
  const visible = useMemo(
    () =>
      repos.filter(
        (r) => (filter === null || r.tier === filter) && (condition === null || condition.repos.includes(r.fullName)),
      ),
    [repos, filter, condition],
  );
  const bands = useMemo(() => clearanceBands(repos), [repos]);
  const edge = useMemo(() => clearanceEdge(repos), [repos]);

  // Register order: lowest clearance first — the un-cleared repos are the work, not the trophies.
  const sorted = useMemo(
    () => [...visible].sort((a, b) => a.tier - b.tier || b.nextProgress - a.nextProgress || a.name.localeCompare(b.name)),
    [visible],
  );

  if (repos.length === 0) {
    return (
      <SectionEmpty>
        No passports yet for this view, so no clearances can be issued. Scan this org&apos;s repositories and each scan
        registers its repo here.
      </SectionEmpty>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading kicker="autonomy clearance" title="Clearance register" />

      {/* First sight is the perimeter itself: nested bands, outermost = most permissive. What a
          clearance PERMITS rides on each tile's `sub` below; what would RAISE one is a per-repo fact
          on the card that owns it, and the promotion plan below lays those facts across the fleet. */}
      <div className="rounded-2xl border border-divider bg-surface/40 p-4">
        <BandLadder bands={bands} edge={edge} title="Clearances held across the fleet" className="mx-auto max-w-md" />
        <Legend states={clearanceStates(bands, edge)} className="mt-3 justify-center" />
      </div>

      {/* Muster ledger — one tile per clearance, and the filter. */}
      <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
        {TIERS.map((t) => {
          const meta = TIER_META[t];
          const active = filter === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(active ? null : t)}
              aria-pressed={active}
              className={`focus-ring block bg-ink text-left transition-colors hover:bg-slate-900 ${active ? "bg-slate-900" : ""}`}
            >
              <div style={{ boxShadow: active ? `inset 3px 0 0 ${tierHex(t)}` : undefined }}>
                <Tile
                  label={`${meta.code} · ${meta.label}`}
                  value={counts[t]}
                  sub={meta.grant}
                  color={tierHex(t)}
                />
              </div>
            </button>
          );
        })}
      </div>

      <PromotionPlan plan={plan} selected={condition} onSelect={setCondition} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Kicker tone="muted">
          {condition !== null
            ? `${visible.length} carry "${condition.label}" toward ${TIER_META[condition.to].code}`
            : filter === null
              ? `${repos.length} repo${repos.length === 1 ? "" : "s"} on the register`
              : `${visible.length} at ${TIER_META[filter].code} · ${TIER_META[filter].label}`}
        </Kicker>
        {condition !== null && (
          <button
            type="button"
            onClick={() => setCondition(null)}
            aria-label={`Clear the condition filter: ${condition.label}`}
            className="focus-ring animate-fade-in rounded border border-slate-700 px-1.5 py-0.5 type-caption text-slate-300 transition hover:border-accent hover:text-white"
          >
            <span aria-hidden>✕</span> {condition.label}
          </button>
        )}
        {filter !== null && (
          <button
            type="button"
            onClick={() => setFilter(null)}
            className="focus-ring animate-fade-in rounded border border-slate-700 px-1.5 py-0.5 type-caption text-slate-300 transition hover:border-accent hover:text-white"
          >
            <span aria-hidden>✕</span> show all clearances
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <SectionEmpty>
          {condition !== null
            ? "No repo at that clearance carries this condition in this scope."
            : "No repo currently holds that clearance in this scope."}
        </SectionEmpty>
      ) : (
        <div className="animate-fade-up grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => (
            <ClearanceCard key={r.fullName} repo={r} />
          ))}
        </div>
      )}
    </div>
  );
}
