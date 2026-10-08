export interface RepoState {
  watched: boolean;
  scanSchedule: string;
  level: string | null;
  overall: number | null;
}

export interface AppRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  url: string;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  state: RepoState | null;
}

export type Visibility = "all" | "public" | "private";

/** The autoscan cadence vocabulary — the single source for route validation, the UI options, and the
 *  cadence→days map. Pure constants (no client deps), so server routes / the DB layer import it too. */
export const SCHEDULES = ["off", "daily", "weekly", "monthly"] as const;
export type Schedule = (typeof SCHEDULES)[number];

/** The one sentence that tells a user what an autoscan cadence also buys. The push throttle is a server
 *  env setting the client cannot see, so no interval is stated. Cost wording follows reserveScanCredit /
 *  isMeteredScan: a metered scan counts against the monthly allowance first, then draws one prepaid
 *  credit; self-hosted installs are never metered. */
export const PUSH_RESCAN_DISCLOSURE =
  "A repo on any autoscan cadence is also rescanned when its default branch is pushed, throttled per repo. " +
  "Each push rescan is a metered scan: it counts against the monthly allowance, then draws one prepaid credit (free on self-hosted installs). " +
  "\"no autoscan\" stops push rescans too.";

/** The single user-facing label for a cadence id. RepoRow and the BulkActionsBar previously diverged
 *  ("no autoscan" vs raw "off") for the same setting, making the two schedule controls read as
 *  different vocabularies — every schedule select renders options through this. */
export function scheduleLabel(s: string): string {
  return s === "off" ? "no autoscan" : s;
}
