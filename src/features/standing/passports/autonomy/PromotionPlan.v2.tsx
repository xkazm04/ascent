"use client";

// Prism promotion plan. Same rows and the same click-to-filter as PromotionPlan. The active row is a
// pressed state in paper, not a tier hue on the inset.
import { Caption, Frame, HairlineList, SectionHead } from "@/components/kit";
import { TIER_META } from "./autonomyModel";
import { RANK_HINT, type PlanSelection } from "./PromotionPlan";
import type { PlanRow, PlanTransition } from "./promotionPlanModel";

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
        className={`focus-ring flex w-full items-baseline justify-between gap-3 px-2 py-2 text-left hover:bg-slate-900 ${active ? "bg-slate-900" : ""}`}
      >
        <span className="min-w-0 text-[0.9375rem] text-slate-200">
          {row.label}
          {row.placeholderRepos.length > 0 && (
            <span className="ml-2 type-caption text-slate-400">
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

export function PromotionPlanV2({
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
    <Frame aria-label="Promotion plan">
      <SectionHead eyebrow="Promotion plan" title="What lifts" named="the most repos." />
      <Caption className="mt-3">{RANK_HINT}</Caption>
      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        {live.map((t) => {
          const from = TIER_META[t.from];
          const to = TIER_META[t.to];
          return (
            <section key={t.to} className="min-w-0 border-l border-divider pl-3">
              <p className="type-label text-slate-400">
                {from.code} → {to.code} · {to.label}
              </p>
              <p className="mt-1 type-caption text-slate-400">
                {plural(t.population, "repo", "repos")} at {from.code}
                {t.unassessable > t.heldRepos.length &&
                  `; ${t.unassessable - t.heldRepos.length} not assessable (no token, so branch protection was not observed). Re-scan with a token.`}
                {t.heldRepos.length > 0 &&
                  `; ${t.heldRepos.length} not assessable (CI workflow files were not read in full, so CI gating is unknown). Re-scan.`}
              </p>
              {t.rows.length > 0 ? (
                <HairlineList className="mt-2">
                  {t.rows.map((row) => (
                    <PlanRowButton key={row.id} row={row} to={t.to} active={selected?.to === t.to && selected.id === row.id} onSelect={onSelect} />
                  ))}
                </HairlineList>
              ) : (
                <p className="mt-2 text-[0.9375rem] text-slate-400">No assessable repo on this step.</p>
              )}
            </section>
          );
        })}
      </div>
    </Frame>
  );
}
