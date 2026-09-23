"use client";

// The promotion plan: per autonomy transition, the conditions ranked by how many repos each one ALONE
// holds back, with how many carry it beside that. It sits above the clearance register and ranks
// CONDITIONS, never repos; a click hands the row's repos to the register as a filter. The arithmetic
// and its honesty rules live in promotionPlanModel.ts (pure; not promotionPlan.ts, which a case-insensitive
// filesystem would resolve for this file's own `./PromotionPlan` import); this file only renders it.

import { Kicker, SectionHeading } from "@/components/ui";
import { TIER_META, tierHex } from "./autonomyModel";
import type { FixableConditionId, PlanRow, PlanTransition } from "./promotionPlanModel";

/** What a click selects: one condition on one transition, with the repos it would lift. */
export interface PlanSelection {
  to: PlanTransition["to"];
  id: FixableConditionId;
  label: string;
  repos: string[];
}

/** The ranking basis, disclosed rather than asserted. */
const RANK_HINT =
  "Alone: repos this condition is the last thing holding back, so fixing it promotes them. Carry it: repos that have it at all. Ties are ordered by condition, never by chance.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function PlanRowButton({
  row,
  to,
  active,
  onSelect,
}: {
  row: PlanRow;
  to: PlanTransition["to"];
  active: boolean;
  onSelect: (s: PlanSelection | null) => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-condition={row.id}
        aria-pressed={active}
        onClick={() => onSelect(active ? null : { to, id: row.id, label: row.label, repos: row.repos })}
        className={`focus-ring flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-slate-900 ${active ? "bg-slate-900" : ""}`}
        style={{ boxShadow: active ? `inset 2px 0 0 ${tierHex(to)}` : undefined }}
      >
        <span className="min-w-0 type-body-sm text-slate-200">
          {row.label}
          {row.placeholderRepos.length > 0 && (
            <span className="ml-2 type-caption text-slate-500">
              incl. {plural(row.placeholderRepos.length, "placeholder scan", "placeholder scans")}
            </span>
          )}
        </span>
        <span className="shrink-0 type-caption tabular-nums text-slate-400">
          <span className={row.sole > 0 ? "text-white" : ""}>{row.sole} alone</span>
          {" · "}
          {row.incidence} carry it
        </span>
      </button>
    </li>
  );
}

export function PromotionPlan({
  plan,
  selected,
  onSelect,
}: {
  plan: PlanTransition[];
  selected: PlanSelection | null;
  onSelect: (s: PlanSelection | null) => void;
}) {
  const live = plan.filter((t) => t.population > 0);
  if (live.length === 0) return null;

  return (
    <div className="rounded-2xl border border-divider bg-surface/40 p-4">
      <SectionHeading size="sm" as="h3" kicker="promotion plan" title="What lifts the most repos" />
      <p className="mt-1 type-caption text-slate-500">{RANK_HINT}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {live.map((t) => {
          const from = TIER_META[t.from];
          const to = TIER_META[t.to];
          return (
            <section key={t.to} className="min-w-0 border-l-2 pl-3" style={{ borderColor: tierHex(t.to) }}>
              <Kicker tone="muted">
                {from.code} → {to.code} · {to.label}
              </Kicker>
              <p className="mt-0.5 type-caption text-slate-500">
                {plural(t.population, "repo", "repos")} at {from.code}
                {t.unassessable > 0 &&
                  `; ${t.unassessable} not assessable (no token, so branch protection was not observed). Re-scan with a token.`}
              </p>
              {t.rows.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {t.rows.map((row) => (
                    <PlanRowButton
                      key={row.id}
                      row={row}
                      to={t.to}
                      active={selected?.to === t.to && selected.id === row.id}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 type-body-sm text-slate-400">No assessable repo on this step.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
