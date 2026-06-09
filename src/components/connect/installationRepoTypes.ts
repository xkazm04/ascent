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

export const SCHEDULES = ["off", "daily", "weekly", "monthly"];
