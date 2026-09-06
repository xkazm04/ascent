// per-tier-budget-tables: the tier vocabulary is defined once (budgets.ts TIERS); each effect keeps
// its own table beside its implementation, typed against it, rows are parameters (a count, a period,
// a layer depth — a sub-part boolean is allowed, a whole-effect switch is not), and the floor row is a
// reduction the author chose. The obligation to carry a table is graded by cost class and published,
// so "does this effect need a budget?" is looked up. The strata field above the tables is the effect.

import { DEGRADATION_GUIDE, OBLIGATIONS, STRATA, STRATA_LOAD_BEARING, TIERS, WASH, WASH_LOAD_BEARING, type Tier } from "./budgets";
import { Region, TierChip } from "./parts";
import { StrataField } from "./StrataField";

function Cell({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <td className={`py-1 pr-2 font-mono tabular-nums ${active ? "text-white" : "text-slate-500"}`}>{children}</td>;
}

export function BudgetRegion({ tier, reduced }: { tier: Tier; reduced: boolean }) {
  return (
    <Region technique="per-tier-budget-tables" title="The tier's meaning lives with the effect" note="One vocabulary, one table per effect, read at render. Allocate at the top row; draw a prefix; a tier change is a bounds change.">
      <StrataField tier={tier} reduced={reduced} />
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <table className="w-full type-caption" data-table="strata">
          <caption className="pb-1 text-left text-slate-400">
            STRATA — drives its own clock → <span className="text-slate-200">must</span> · load-bearing: {STRATA_LOAD_BEARING}
          </caption>
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-normal">tier</th>
              <th className="font-normal">lines</th>
              <th className="font-normal">drift</th>
              <th className="font-normal">glow pass</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((t) => (
              <tr key={t} className="border-t border-divider" data-row={t} aria-current={t === tier ? "true" : undefined}>
                <td className="py-1 pr-2"><TierChip tier={t} /></td>
                <Cell active={t === tier}>{STRATA[t].lines}</Cell>
                <Cell active={t === tier}>{STRATA[t].driftMs === 0 ? "static" : `${STRATA[t].driftMs / 1000}s`}</Cell>
                <Cell active={t === tier}>{STRATA[t].glowPass ? "on" : "off"}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full type-caption" data-table="wash">
          <caption className="pb-1 text-left text-slate-400">
            WASH — forces compositing → <span className="text-slate-200">should</span> · load-bearing: {WASH_LOAD_BEARING}
          </caption>
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-normal">tier</th>
              <th className="font-normal">layers</th>
              <th className="font-normal">opacity ceiling</th>
              <th className="font-normal">guide</th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((t) => (
              <tr key={t} className="border-t border-divider" data-row={t} aria-current={t === tier ? "true" : undefined}>
                <td className="py-1 pr-2"><TierChip tier={t} /></td>
                <Cell active={t === tier}>{WASH[t].layers}</Cell>
                <Cell active={t === tier}>{WASH[t].opacityCeiling}</Cell>
                <td className="py-1 text-slate-500">{DEGRADATION_GUIDE[t]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1" aria-label="Which effects owe a table">
        {OBLIGATIONS.map((o) => (
          <li key={o.obligation} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-divider pt-1 type-caption" data-obligation={o.obligation}>
            <span className="text-slate-400">{o.cls}</span>
            <span className="font-mono text-slate-200">
              {o.obligation} <span className="text-slate-600">— {o.why}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 type-caption text-slate-500">The floor row is a reduction (3 static lines), not an absence: zero would delete the only structure the header has.</p>
    </Region>
  );
}
