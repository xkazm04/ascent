// The briefing's two denominators, printed side by side — Direction 1 + Direction 2.
//
// They answer different questions and were previously conflated into one:
//   • COVERAGE — how much of the fleet did we look at (`scanned` of `total`). The PDF and the
//     "Copy for LLM" markdown printed this; the tab and the share page never did, so the two
//     HTML surfaces were the ones with no stated coverage at all.
//   • SCORE BASIS — what the three headline averages are actually averaged over (`realScoredCount`,
//     mock placeholders excluded). When that is 0 the averages are a division guard, not a grade,
//     and this is where the reason for the "—" in the tiles above is stated.
//
// Server component, no hooks or handlers, so it carries no "use client". Both call sites (the
// authenticated Briefing tab and the anonymous /share/briefing/[token] page) render it identically:
// nothing here is an internal-only affordance — there are no links and no identifiers, only two
// counts the board reader is entitled to.

import { coverageLine, noScoreLine, scoreBasisLine, type ExecBriefing } from "@/lib/org/briefing";

export function BriefingBasisNote({ briefing, className = "" }: { briefing: ExecBriefing; className?: string }) {
  const basis = scoreBasisLine(briefing);
  const noScore = noScoreLine(briefing);
  return (
    <p className={`${className} type-mono-sm text-slate-500`.trim()}>
      {coverageLine(briefing)}
      {basis ? <> · {basis}</> : null}
      {/* Never quieter than the data (G1): the absence of a score is stated in words, in the same
          slot the basis would have occupied, rather than leaving four em dashes unexplained. */}
      {noScore ? <span className="text-warn"> · {noScore}</span> : null}
    </p>
  );
}
