// Fleet-wide activity figures for the Repositories masthead. Pure. A repo with no GitHub activity read
// contributes nothing (it is absent, not zero); when NO repo carries a read the whole figure is null so the
// masthead states "not measured" instead of printing 0.
import type { RepoActivity } from "./RepoLeaderboardParts";

export interface FleetActivity {
  commits: number;
  prsMerged: number;
  /** Repos that carried an activity read: the denominator to print beside the sums. */
  measured: number;
}

export function fleetActivity(rows: { activity: RepoActivity | null }[]): FleetActivity | null {
  let commits = 0;
  let prsMerged = 0;
  let measured = 0;
  for (const r of rows) {
    if (!r.activity) continue;
    measured += 1;
    commits += r.activity.commitsWeekly.reduce((t, n) => t + n, 0);
    prsMerged += r.activity.prsMerged;
  }
  return measured === 0 ? null : { commits, prsMerged, measured };
}
