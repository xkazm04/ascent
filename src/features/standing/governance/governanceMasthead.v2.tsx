// The page's one dominant element: how much of the judged fleet clears the bar. Figures stay paper;
// status is a glyph and a word (hue-versus-meaning). An unjudged repo is its own figure, never folded
// into the rate. No overview means nothing was measured: no zero tiles.
import type { ReactNode } from "react";
import { Masthead, type MastheadFigure, type MastheadTone } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import type { GovernanceOverview } from "@/lib/org/governance";

const EMPTY_SCOPED =
  "No scanned repositories for this filter. Pick another segment or stack, or clear the filter to evaluate the whole fleet.";
const EMPTY_FLEET =
  "No scanned repositories yet. Scan some of this org's repositories to evaluate the fleet against the governance gate.";

function rateTone(g: GovernanceOverview): MastheadTone {
  if (g.assessed === 0) return "watch";
  return g.failing > 0 ? "risk" : "good";
}

function figures(g: GovernanceOverview): MastheadFigure[] {
  const rows: MastheadFigure[] = [
    {
      label: "Gate pass rate",
      value: `${g.passRate}%`,
      detail: `${g.passing}/${g.assessed} judged`,
      tone: rateTone(g),
      title: "Share of judged repos that clear the org bar. Repos that scored nothing are not in this rate.",
    },
    { label: "Passing", value: String(g.passing), detail: "clear the gate", tone: g.passing > 0 ? "good" : undefined },
    {
      label: "Failing",
      value: String(g.failing),
      detail: "below the bar",
      tone: g.failing > 0 ? "risk" : "good",
    },
    { label: "Repos scanned", value: String(g.scanned), detail: "in the fleet" },
  ];
  if (g.incomplete > 0) {
    rows.push({
      label: "Not judged",
      value: String(g.incomplete),
      detail: "scored nothing",
      tone: "watch",
      title: "Scanned repos with no dimension score. Excluded from the pass rate.",
    });
  }
  return rows;
}

export function GovernanceMastheadV2({
  g,
  scoped,
  filterBar,
  brief,
}: {
  g: GovernanceOverview | null;
  scoped: boolean;
  filterBar: ReactNode;
  brief: string | null;
}) {
  const aside = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {filterBar}
      {brief && <CopyForLlm text={brief} label="Copy governance brief for LLM" />}
    </div>
  );
  if (!g) {
    return (
      <Masthead
        eyebrow="Governance"
        statement="Nothing is judged yet."
        named={scoped ? "This filter has no scans." : "Scan a repository."}
        lede={scoped ? EMPTY_SCOPED : EMPTY_FLEET}
        aside={aside}
        pattern="spectral"
      />
    );
  }
  return (
    <Masthead
      eyebrow="Governance"
      statement={g.assessed === 0 ? "No repo could be judged." : `${g.passRate}% of judged repos`}
      named={g.assessed === 0 ? "Every scan scored nothing." : "clear the gate."}
      lede={
        g.failing > 0
          ? "The org bar, applied to every judged repository in this reading. Failing repos are listed below."
          : "The org bar, applied to every judged repository in this reading."
      }
      figures={figures(g)}
      aside={aside}
      pattern="spectral"
    />
  );
}
