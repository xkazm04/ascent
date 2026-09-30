"use client";

// The Prism (v2) leaderboard: a toolbar (select-all on the left, the three activity sorts as a Segmented on the
// right) over a ruled list of kit RepoRows. It renders the state useRepoLeaderboard already computed for v1
// (`v`), so sort cycle, selection and the bulk bar behave identically in both themes.
import { HairlineList, Segmented, Toolbar } from "@/components/kit";
import { RepoLeaderboardBulkBar } from "./RepoLeaderboardBulkBar";
import { RepoLeaderboardRowV2 } from "./RepoLeaderboardRow.v2";
import type { SortKey } from "./RepoLeaderboardParts";
import type { SegmentItem, useRepoLeaderboard } from "./useRepoLeaderboard";

const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: "commits", label: "Commits", title: "Commits over the past ~4 weeks, from GitHub. Click to sort; click again to reverse; a third click restores the score order." },
  { key: "pr", label: "Merged PRs", title: "Merged pull requests across the analyzed PR window. Click to sort." },
  { key: "loc", label: "Lines changed", title: "Lines changed (additions + deletions) across the analyzed PR window. Click to sort." },
];

export function RepoLeaderboardV2({
  slug,
  rowCount,
  segments,
  schedulable,
  v,
}: {
  slug: string;
  rowCount: number;
  segments: SegmentItem[];
  schedulable: boolean;
  v: ReturnType<typeof useRepoLeaderboard>;
}) {
  const hasSegments = segments.length > 0;
  const arrow = v.sort ? (v.sort.dir === -1 ? " ▼" : " ▲") : "";
  return (
    <>
      <Toolbar
        className="mb-2"
        left={
          hasSegments ? (
            <label className="flex items-center gap-2 type-body-sm text-slate-300">
              <input
                type="checkbox"
                checked={v.allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = v.selected.size > 0 && v.selected.size < rowCount;
                }}
                onChange={v.toggleAll}
                aria-label="Select all repositories"
                className="accent-accent"
              />
              {v.selected.size > 0 ? `${v.selected.size} selected` : "Select all"}
            </label>
          ) : undefined
        }
        right={
          <>
            <span className="type-caption text-slate-400">Sort by</span>
            <Segmented
              label="Sort repositories by activity"
              value={v.sort?.key ?? null}
              onSelect={(k) => v.cycleSort(k as SortKey)}
              options={SORTS.map((s) => ({ key: s.key, title: s.title, label: `${s.label}${v.sort?.key === s.key ? arrow : ""}` }))}
            />
          </>
        }
      />
      <HairlineList as="ul" aria-label="Repository leaderboard, best score first">
        {v.sortedRows.map((r) => (
          <RepoLeaderboardRowV2
            key={r.fullName}
            r={r}
            slug={slug}
            schedulable={schedulable}
            hasSegments={hasSegments}
            selected={v.selected.has(r.fullName)}
            onToggle={v.toggle}
          />
        ))}
      </HairlineList>
      {v.selected.size > 0 && hasSegments && (
        <RepoLeaderboardBulkBar
          count={v.selected.size}
          segments={segments}
          target={v.target}
          setTarget={v.setTarget}
          busy={v.busy}
          error={v.error}
          onAdd={v.addToSegment}
          onClear={v.clearSelected}
        />
      )}
      {v.done && <p className="mt-2 type-body-sm text-slate-300">{v.done}</p>}
    </>
  );
}
