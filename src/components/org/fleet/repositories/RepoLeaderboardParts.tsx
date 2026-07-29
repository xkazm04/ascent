"use client";

// Co-located parts for RepoLeaderboard, split out to keep that file under the 300-LOC/.tsx budget:
// the activity-column type, the sort machinery, and the table head. Pure relocation — behavior is
// identical to the former inline versions. Sort state + the cycle handler live in the parent.

/** Repo-activity signals for the fleet table's activity columns (projected from the latest scan's
 *  GitHub blobs in getOrgRollup). Null when the latest scan ingested neither — the row shows "—". */
export interface RepoActivity {
  /** Trailing ~1 month of weekly commit totals (oldest→newest). */
  commitsWeekly: number[];
  prsMerged: number;
  prsTotal: number;
  locChanged: number;
}

export type SortKey = "commits" | "pr" | "loc";
export type SortState = { key: SortKey; dir: 1 | -1 } | null;

export const sum = (xs: number[]) => xs.reduce((t, n) => t + n, 0);

/** Sort value for an activity column; a null-activity row sorts to -1 so it always trails a real one. */
export function activityValue(a: RepoActivity | null, key: SortKey): number {
  if (!a) return -1;
  if (key === "commits") return sum(a.commitsWeekly); // total over the ~1-month window (matches the shown number)
  if (key === "pr") return a.prsMerged;
  return a.locChanged;
}

/** A sortable activity-column header — click cycles most-first → least-first → default (incoming order). */
function SortTh({
  label,
  title,
  thClass,
  active,
  dir,
  onClick,
}: {
  label: string;
  title: string;
  thClass: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th className={thClass} aria-sort={active ? (dir === -1 ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`focus-ring rounded transition hover:text-accent ${active ? "text-accent" : ""}`}
      >
        {label}
        {active ? (dir === -1 ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );
}

/** The leaderboard table head — select-all checkbox, identity columns, and the three sortable
 *  activity columns (Commits · PR · LoC Δ). */
export function LeaderboardHead({
  hasSegments,
  allSelected,
  indeterminate,
  onToggleAll,
  sort,
  onCycle,
}: {
  hasSegments: boolean;
  allSelected: boolean;
  /** True when some (but not all) rows are selected — renders the header checkbox as a dash rather
   *  than fully unchecked, so a partial selection doesn't read as "none selected." `indeterminate` is a
   *  DOM property, not an HTML attribute, so it can't be set from JSX and is applied via a ref below. */
  indeterminate: boolean;
  onToggleAll: () => void;
  sort: SortState;
  onCycle: (key: SortKey) => void;
}) {
  const dir = sort?.dir ?? -1;
  return (
    <tr>
      <th className="px-3 py-2 text-left">
        {hasSegments && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = indeterminate;
            }}
            onChange={onToggleAll}
            aria-label="Select all repositories"
            className="accent-accent"
          />
        )}
      </th>
      <th className="px-4 py-2 text-left">Repo</th>
      <th className="px-3 py-2 text-left">Level</th>
      <SortTh
        label="Commits"
        title="Commits over the past ~4 weeks (≈1 month), from GitHub — click to sort"
        thClass="px-3 py-2 text-left"
        active={sort?.key === "commits"}
        dir={dir}
        onClick={() => onCycle("commits")}
      />
      <SortTh
        label="PR"
        title="Merged pull requests across the analyzed PR window — click to sort"
        thClass="px-3 py-2 text-right"
        active={sort?.key === "pr"}
        dir={dir}
        onClick={() => onCycle("pr")}
      />
      <SortTh
        label="LoC Δ"
        title="Lines changed (additions + deletions) across the analyzed PR window — click to sort"
        thClass="px-3 py-2 text-right"
        active={sort?.key === "loc"}
        dir={dir}
        onClick={() => onCycle("loc")}
      />
      <th className="px-3 py-2 text-left">Last scan</th>
      <th className="px-3 py-2 text-left">Autoscan</th>
      <th className="px-3 py-2 text-left">
        <span className="sr-only">Rescan</span>
      </th>
    </tr>
  );
}
