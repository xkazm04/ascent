"use client";

// The Repositories-tab leaderboard with row selection + a sticky bulk-action bar: tick repos, then
// tag the whole set into a segment in one call (POST /api/org/segments/:id/repos/bulk). The table
// markup mirrors the prior server render; only selection + the bar are client state.
//
// Selection/sort/bulk-tag state lives in useRepoLeaderboard.ts (owns no JSX); the row markup
// (RepoLeaderboardRow) and the sticky bar (RepoLeaderboardBulkBar) are extracted siblings — this file
// stays under the 200-LOC cap (AGENTS.md) by keeping the JSX itself thin.

import { OrgTable } from "@/components/org/shared/ui";
import { LeaderboardHead } from "./RepoLeaderboardParts";
import { RepoLeaderboardRow } from "./RepoLeaderboardRow";
import { RepoLeaderboardBulkBar } from "./RepoLeaderboardBulkBar";
import { RepoLeaderboardV2 } from "./RepoLeaderboard.v2";
import type { ThemeId } from "@/lib/theme/theme";
import { useRepoLeaderboard, type LeaderRow, type SegmentItem } from "./useRepoLeaderboard";

export function RepoLeaderboard({
  slug,
  rows,
  segments,
  schedulable,
  theme = "altimeter",
}: {
  slug: string;
  rows: LeaderRow[];
  segments: SegmentItem[];
  schedulable: boolean;
  /** Picks the composition; both read the same useRepoLeaderboard state. */
  theme?: ThemeId;
}) {
  const view = useRepoLeaderboard({ slug, rows, segments });
  if (theme === "prism") return <RepoLeaderboardV2 slug={slug} rowCount={rows.length} segments={segments} schedulable={schedulable} v={view} />;
  const {
    sort,
    cycleSort,
    sortedRows,
    selected,
    allSelected,
    target,
    setTarget,
    busy,
    done,
    error,
    toggle,
    toggleAll,
    addToSegment,
    clearSelected,
  } = view;

  return (
    <>
      <OrgTable
        className="mt-3"
        caption="Repository maturity leaderboard with segment selection"
        head={
          <LeaderboardHead
            hasSegments={segments.length > 0}
            allSelected={allSelected}
            indeterminate={selected.size > 0 && selected.size < rows.length}
            onToggleAll={toggleAll}
            sort={sort}
            onCycle={cycleSort}
          />
        }
      >
        {sortedRows.map((r) => (
          <RepoLeaderboardRow
            key={r.fullName}
            r={r}
            slug={slug}
            schedulable={schedulable}
            hasSegments={segments.length > 0}
            selected={selected.has(r.fullName)}
            onToggle={toggle}
          />
        ))}
      </OrgTable>

      {/* Sticky bulk-action bar — appears once repos are ticked. */}
      {selected.size > 0 && segments.length > 0 && (
        <RepoLeaderboardBulkBar
          count={selected.size}
          segments={segments}
          target={target}
          setTarget={setTarget}
          busy={busy}
          error={error}
          onAdd={addToSegment}
          onClear={clearSelected}
        />
      )}
      {done && <p className="mt-2 type-mono-sm text-emerald-300">{done}</p>}
    </>
  );
}
