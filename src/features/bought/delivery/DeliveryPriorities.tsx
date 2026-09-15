// "Fix first" — the delivery tab's derived punch list. Turns the fleet's PR + governance aggregates
// into at most four concrete, evidence-backed actions (protect branches, require approvals, lift
// review coverage, govern AI PRs, shorten merges), each linking to the section or table that proves
// it. Deterministic server derivation — no LLM, no extra queries; it reads the data the page already
// fetched. Deliberately NOT a card grid: one list surface, severity carried by a labelled chip.

import { Surface } from "@/components/ui";
import { derivePriorities, type Priority } from "./derivePriorities";
import type { OrgGovernance, OrgPrSignals } from "@/lib/db";

// Kept as a re-export so `derivePriorities`' one call site outside this file (its test) and any
// future consumer can keep importing it from the component it belongs to.
export { derivePriorities } from "./derivePriorities";

const CHIP: Record<Priority["severity"], string> = {
  fix: "border-warn/40 bg-warn/10 text-orange-300",
  improve: "border-accent/40 bg-accent/10 text-accent-soft",
};

export function DeliveryPriorities({ pr, gov }: { pr: OrgPrSignals | null; gov: OrgGovernance | null }) {
  const priorities = derivePriorities(pr, gov);

  if (priorities.length === 0) {
    return (
      <Surface radius="xl" className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className="text-lime-400">✓</span>
        <p className="type-body-sm text-slate-400">
          No delivery red flags: branch protection, review coverage, and merge flow all clear the bar.
        </p>
      </Surface>
    );
  }

  return (
    <Surface radius="xl">
      <div className="border-b border-divider px-4 py-2.5 type-label tracking-[0.2em] text-slate-500">
        Fix first · {priorities.length} action{priorities.length > 1 ? "s" : ""} from this fleet&apos;s signals
      </div>
      <ul className="divide-y divide-divider">
        {priorities.map((p) => (
          <li key={p.title} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap">
            <span className={`shrink-0 self-center rounded border px-1.5 py-0.5 type-label tracking-widest ${CHIP[p.severity]}`}>
              {p.severity === "fix" ? "fix now" : "improve"}
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-medium text-white">{p.title}</span>
              <span className="ml-2 type-body-sm text-slate-400">{p.evidence}</span>
            </div>
            <a href={p.href} className="focus-ring shrink-0 self-center type-mono-sm text-accent transition hover:text-white">
              {p.action} ↓
            </a>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
