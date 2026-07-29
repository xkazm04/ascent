"use client";

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { InitiativesPanelRow } from "@/components/org/plan/InitiativesPanelRow";
import { useInitiativesPanel } from "@/components/org/plan/useInitiativesPanel";
import type { GoalOption, InitiativeView, SeedRec } from "@/components/org/plan/InitiativesPanelTypes";

export type { GoalOption, InitiativeView, SeedRec } from "@/components/org/plan/InitiativesPanelTypes";

/** Tracked, scoped programs of work — created from the fleet's highest-leverage moves. State +
 *  handlers live in `useInitiativesPanel`; a row's markup lives in `InitiativesPanelRow` (200-LOC cap). */
export function InitiativesPanel({
  slug,
  initial,
  seeds,
  goals = [],
}: {
  slug: string;
  initial: InitiativeView[];
  seeds: SeedRec[];
  /** Active goals this org steers toward — an initiative can be linked to the one it advances. */
  goals?: GoalOption[];
}) {
  const { items, busy, error, track, patch } = useInitiativesPanel({ slug, initial, goals });

  const trackedTitles = new Set(items.map((i) => i.title));
  const available = seeds.filter((s) => !trackedTitles.has(s.title)).slice(0, 5);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Initiatives"
        description="Bundle a fleet move into a tracked program — progress counts the scoped repos already at target."
      />

      <div className="mt-4 space-y-3">
        {items.length === 0 && <p className="text-base text-slate-500">No initiatives yet — start one from a fleet move below.</p>}
        {items.map((i) => (
          <InitiativesPanelRow key={i.id} slug={slug} i={i} goals={goals} onPatch={patch} />
        ))}
      </div>

      {available.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Start from a fleet move</div>
          <div className="mt-2 space-y-2">
            {available.map((s) => (
              <div key={s.title} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-base text-slate-200">{s.title}</div>
                  {/* Show the MAPPED scope (what track() actually POSTs), not the rec's pre-map count —
                      repos that don't resolve to a current-scan fullName are dropped, so advertising the
                      original count promised repos the initiative never scopes (goals-initiatives #3). */}
                  <div className="font-mono text-sm text-slate-500">
                    {s.dimId} · affects {s.repos.length} repo{s.repos.length === 1 ? "" : "s"}
                    {s.repoCount > s.repos.length ? ` (of ${s.repoCount} — others aren't in the latest scan)` : ""}
                  </div>
                </div>
                <button
                  onClick={() => track(s)}
                  disabled={busy === s.title || s.repos.length === 0}
                  title={s.repos.length === 0 ? "None of this recommendation's repos are in the latest scan — nothing to scope" : undefined}
                  className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
                >
                  {busy === s.title ? "…" : "Track"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}
