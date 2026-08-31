// "Where the fleet fails" card — per-condition breakdown. Extracted from the old governance
// page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region split).

import { Card, InlineEmpty, Meter, SectionHeader } from "@/components/org/shared/ui";
import { FLEET_UNJUDGED_NOTE, GOVERNANCE_FAIL_REASONS, unjudgedBarsDeclared } from "./governanceReasons";
import type { GovernanceOverview } from "@/lib/org/governance";

export function GovernanceFailReasonsCard({ g }: { g: GovernanceOverview }) {
  return (
    <Card>
      <SectionHeader size="sm" title="Where the fleet fails" description="Repos failing each gate condition (counted once per repo)." />
      {/* "failing === 0" is NOT "everything is fine": a repo that scored nothing is neither a pass
          nor a failure, so a fleet of unscorable repos would otherwise print the all-clear. Name the
          unjudged bucket instead — the whole point of the third bucket is that it stays visible. */}
      {g.failing === 0 ? (
        <InlineEmpty>
          {g.assessed === 0
            ? "No repo could be judged yet — every scanned repo scored nothing."
            : g.incomplete > 0
              ? `Every judged repo clears the gate — but ${g.incomplete} of ${g.scanned} scored nothing and was not judged.`
              : "Every scanned repo clears the gate."}
          {/* …of the conditions this view can judge. The all-clear used to be unqualified even when
              the org's bar carried a criterion the fleet path never evaluates (PRIYA-L1-02), which
              is the same over-claim as the 0-meter, just louder. */}
          {unjudgedBarsDeclared(g.savedPolicy) ? ` Not included: ${FLEET_UNJUDGED_NOTE}.` : ""}
        </InlineEmpty>
      ) : (
        <div className="mt-3 space-y-2">
          {GOVERNANCE_FAIL_REASONS.map((r) => {
            const n = g.byReason[r.key];
            // A criterion the fleet path can never evaluate must not borrow the vocabulary of one it
            // measured. Rendering its structural 0 as a live meter told a lead who had just declared
            // two required controls that zero repos fail them — while the per-repo CI gate blocked
            // PRs on exactly those (UAT PRIYA-L1-02). Same row, same order, honest reading.
            if (!r.fleetJudged) {
              return (
                <div key={r.key} className="flex items-center gap-3 type-body-sm">
                  <span className="w-44 shrink-0 text-slate-500">{r.label}</span>
                  <span className="flex-1 text-slate-500">{FLEET_UNJUDGED_NOTE}</span>
                  <span className="w-16 shrink-0 text-right font-mono text-slate-600">—</span>
                </div>
              );
            }
            // Two populations, because the buckets are not measured over the same one. A gate
            // condition is divided by the JUDGED repos — an unscorable repo never had the chance
            // to fail it, so counting it dilutes the bar toward a friendlier number. But
            // `incomplete` counts the repos judging EXCLUDED, so dividing it by `assessed` can
            // exceed 100% (and reads 0% against an empty denominator when nothing was judged).
            // It is a share of everything scanned; nothing else is.
            const denom = r.key === "incomplete" ? g.scanned : g.assessed;
            const pct = denom ? Math.round((n / denom) * 100) : 0;
            return (
              <div key={r.key} className="flex items-center gap-3 type-body-sm">
                <span className="w-44 shrink-0 text-slate-400">{r.label}</span>
                <Meter className="flex-1" value={pct} color={n ? "#ef4444" : "#334155"} />
                <span className="w-16 shrink-0 text-right font-mono text-slate-300">{n} repo{n === 1 ? "" : "s"}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
