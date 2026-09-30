// Prism punch list. Same derivePriorities result. Severity is a glyph and a word, and the
// action stays a hash link (the kit has no pressable row).
import { Frame, HairlineList, SectionHead } from "@/components/kit";
import { derivePriorities } from "./derivePriorities";
import type { OrgGovernance, OrgPrSignals } from "@/lib/db";

export function DeliveryPrioritiesV2({ pr, gov }: { pr: OrgPrSignals | null; gov: OrgGovernance | null }) {
  const priorities = derivePriorities(pr, gov);
  if (priorities.length === 0) {
    return (
      <Frame pad="sm">
        <p className="type-body text-slate-400">
          <span className="sr-only">Healthy: </span>
          <span aria-hidden className="mr-2">✓</span>
          No delivery red flags: branch protection, review coverage, and merge flow all clear the bar.
        </p>
      </Frame>
    );
  }
  return (
    <Frame pad="sm">
      <SectionHead
        eyebrow="Fix first"
        title={`${priorities.length} action${priorities.length === 1 ? "" : "s"}`}
        named="from this fleet's signals."
      />
      <HairlineList className="mt-4">
        {priorities.map((p) => {
          const atRisk = p.severity === "fix";
          return (
            <li key={p.title} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
              <span className="shrink-0 text-slate-400">
                <span className="sr-only">{atRisk ? "At risk" : "Watch"}: </span>
                <span aria-hidden className="mr-1">{atRisk ? "▲" : "◆"}</span>
                {atRisk ? "At risk" : "Watch"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-white">{p.title}</span>
                <span className="ml-2 text-slate-400">{p.evidence}</span>
              </span>
              <a href={p.href} className="focus-ring shrink-0 text-slate-300 hover:text-white">
                {p.action}
              </a>
            </li>
          );
        })}
      </HairlineList>
    </Frame>
  );
}
