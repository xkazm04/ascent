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
