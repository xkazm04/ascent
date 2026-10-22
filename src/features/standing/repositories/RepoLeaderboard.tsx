"use client";

// The Repositories-tab leaderboard (Prism composition). Selection/sort/bulk-tag state lives in
// useRepoLeaderboard.ts (owns no JSX); the markup is RepoLeaderboardView.

import { RepoLeaderboardView } from "./RepoLeaderboardView";
import { useRepoLeaderboard, type LeaderRow, type SegmentItem } from "./useRepoLeaderboard";

export function RepoLeaderboard({
  slug,
  rows,
  segments,
  schedulable,
}: {
  slug: string;
  rows: LeaderRow[];
  segments: SegmentItem[];
  schedulable: boolean;
}) {
  const view = useRepoLeaderboard({ slug, rows, segments });
  return <RepoLeaderboardView slug={slug} rowCount={rows.length} segments={segments} schedulable={schedulable} v={view} />;
}
