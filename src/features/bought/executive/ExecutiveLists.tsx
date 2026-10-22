// Movers and goals. Report links stay real hrefs. An unmeasured goal is a void, and 0% is a real zero.
import { Frame, HairlineList, ListRow, SectionHead, VoidMark } from "@/components/kit";
import { briefingGoalStats, type BriefingGoal, type BriefingMove } from "@/lib/org/briefing";
import { PaperMovement } from "./executiveMarks";

export function executiveMovement(gainers: BriefingMove[], regressions: BriefingMove[]) {
  if (gainers.length === 0 && regressions.length === 0) return null;
  const row = (m: BriefingMove, kind: "Improved" | "Regressed") => (
    <ListRow
      key={`${kind}-${m.name}`}
      href={m.fullName ? `/report/${m.fullName}` : undefined}
      title={m.name}
      detail={[kind, m.levelFrom !== m.levelTo ? `${m.levelFrom} to ${m.levelTo}` : null].filter(Boolean).join(" · ")}
      trailing={m.dOverall !== 0 ? <PaperMovement delta={m.dOverall} basis="overall" /> : undefined}
    />
  );
  return (
    <Frame>
      <SectionHead eyebrow="Movement" title="Repos that moved" named="this period" />
      <HairlineList className="mt-4">
        {gainers.map((m) => row(m, "Improved"))}
        {regressions.map((m) => row(m, "Regressed"))}
      </HairlineList>
    </Frame>
  );
}

export function executiveGoals(goals: BriefingGoal[], omittedNotice?: string | null) {
  if (goals.length === 0) {
    // No goals and no notice: omit the section (goals are read-only; there is no action to invite).
    if (!omittedNotice) return null;
    return (
      <Frame>
        <SectionHead eyebrow="Goals" title={omittedNotice} />
      </Frame>
    );
  }
  return (
    <Frame>
      <SectionHead eyebrow="Goals" title="Standing against" named="each target" />
      <HairlineList className="mt-4">
        {goals.map((g) => (
          <ListRow
            key={g.label}
            title={g.label}
            detail={briefingGoalStats(g)}
            trailing={g.pct == null ? <VoidMark label="not measured" subject={g.label} /> : <span className="tabular-nums text-white">{g.pct}%</span>}
          />
        ))}
      </HairlineList>
    </Frame>
  );
}
