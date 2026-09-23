export interface OrgRepo {
  fullName: string;
  private: boolean;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  /** The repo's standing in this org (App path only, from the `state` /api/app/repos merges into each
   *  row): null = the org has never scanned it. ABSENT (undefined) on the public-handle path, whose
   *  listing carries no state; the select step then shows no chips and no selection mix. */
  standing?: RepoStanding | null;
}

/** What the org already knows about one repo, as the select step reads it (repoStanding.ts). */
export interface RepoStanding {
  /** The latest scan's level, or null when the repo is tracked (e.g. watched) but never scanned. */
  level: string | null;
  overall: number | null;
  watched: boolean;
  /** The repo's autoscan cadence ("off" | "daily" | "weekly" | "monthly"). */
  schedule: string;
  /** The latest scan's time, ISO. */
  scannedAt: string | null;
  /** The latest scan was a PREVIEW (the deterministic mock): its live scan is still owed, so the repo
   *  is neither "unchanged, free to rescan" nor already covered. */
  preview: boolean;
}
