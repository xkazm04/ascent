// Masthead copy for the practices tab. Pure: the tiles and the Prism figures read one summary.
import type { MastheadTone } from "@/components/kit";
import type { PracticeLibrarySummary } from "@/lib/org/practice-library";

export interface PracticeFigureModel {
  label: string;
  value: string;
  detail: string;
  tone?: MastheadTone;
  /** No measurement yet. The figure renders a void, never a zero or a dash. */
  unknown?: boolean;
  title?: string;
}

export function practiceStatement(summary: PracticeLibrarySummary): { statement: string; named: string; lede: string } {
  if (summary.total === 0) {
    return {
      statement: "Nothing is in the library yet.",
      named: "Author a practice, or scan the fleet.",
      lede: "Authored standards and practices mined from repository scans share this page.",
    };
  }
  const noun = summary.total === 1 ? "practice" : "practices";
  return {
    statement: "The library holds",
    named: `${summary.total} ${noun}.`,
    lede: `${summary.authored} authored, ${summary.mined} mined. Fleet adoption counts scored repo-practice pairs. A young library is a baseline, not a failing grade.`,
  };
}

export function practiceFigures(summary: PracticeLibrarySummary): PracticeFigureModel[] {
  const roll = summary.rollout;
  const adopt = summary.adoption;
  const could = summary.couldAdopt;
  return [
    {
      label: "Practices",
      value: String(summary.total),
      detail: `${summary.authored} authored, ${summary.mined} mined`,
    },
    adopt
      ? {
          label: "Fleet adoption",
          value: `${adopt.pct}%`,
          detail: `${adopt.strong}/${adopt.measured} repo-practice pairs`,
          title: "Share of scored repo-practice pairs already at the strong floor.",
        }
      : {
          label: "Fleet adoption",
          value: "not measured",
          detail: "no scored repos yet",
          unknown: true,
          title: "No repository has a scored practice yet.",
        },
    {
      label: "Could adopt",
      value: String(could.repos),
      detail: `repos below the bar on ${could.practices} practice${could.practices === 1 ? "" : "s"}`,
    },
    roll
      ? {
          label: "PRs in flight",
          value: String(roll.open),
          detail: `${roll.merged} landed${roll.lift != null ? `, +${roll.lift} avg lift` : ""}`,
          title: "Starter pull requests opened from this library.",
        }
      : {
          label: "PRs in flight",
          value: "not measured",
          detail: "no starter PRs opened yet",
          unknown: true,
          title: "No practice here has been applied, so there is no pull-request count.",
        },
  ];
}
