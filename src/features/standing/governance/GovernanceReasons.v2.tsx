// Where the fleet fails, as ruled rows. A condition the fleet path cannot judge is a void, never a
// zero meter. An earned zero keeps its count and the note from governanceReasons. No status hue:
// the count is paper, the shortfall is the words.
import { Frame, HairlineList, SectionHead, VoidMark } from "@/components/kit";
import {
  FLEET_UNJUDGED_NOTE,
  GOVERNANCE_FAIL_REASONS,
  earnedZeroNote,
  unjudgedBarDeclaration,
  unjudgedBarsDeclared,
} from "./governanceReasons";
import type { GovernanceOverview } from "@/lib/org/governance";

function clearSentence(g: GovernanceOverview): string {
  const base =
    g.assessed === 0
      ? "No repo could be judged yet: every scanned repo scored nothing."
      : g.incomplete > 0
        ? `Every judged repo clears the gate, but ${g.incomplete} of ${g.scanned} scored nothing and was not judged.`
        : "Every scanned repo clears the gate.";
  return unjudgedBarsDeclared(g.savedPolicy) ? `${base} Not included: ${FLEET_UNJUDGED_NOTE}.` : base;
}

export function GovernanceReasonsV2({ g }: { g: GovernanceOverview }) {
  return (
    <Frame aria-label="Where the fleet fails">
      <SectionHead eyebrow="Conditions" title="Where the fleet fails," named="counted once per repo." />
      {g.failing === 0 ? (
        <p className="mt-4 max-w-[40rem] type-body text-slate-300">{clearSentence(g)}</p>
      ) : (
        <HairlineList className="mt-5">
          {GOVERNANCE_FAIL_REASONS.map((r) => {
            const n = g.byReason[r.key];
            if (!r.fleetJudged) {
              const declared = unjudgedBarDeclaration(r.key, g.savedPolicy);
              return (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
                  <span className="text-slate-200">{r.label}</span>
                  <span className="min-w-0 flex-1 text-slate-400">
                    {FLEET_UNJUDGED_NOTE}
                    {declared ? `: ${declared}` : ""}
                  </span>
                  <VoidMark subject={r.label} label="Not measured" />
                </li>
              );
            }
            const denom = r.key === "incomplete" ? g.scanned : g.assessed;
            const pct = denom ? Math.round((n / denom) * 100) : 0;
            const earned = earnedZeroNote(r.key, n, g.assessed, g.measuredOn, g.barSet);
            return (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <span className="min-w-44 text-slate-200">{r.label}</span>
                <span className="min-w-0 flex-1 text-slate-400">{earned ?? `${pct}% of ${r.key === "incomplete" ? "scanned" : "judged"}`}</span>
                <span className="tabular-nums text-slate-100">
                  {n} repo{n === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
        </HairlineList>
      )}
    </Frame>
  );
}
