// The drawer entries for the table scene: one per technique of the registry's `table` subject
// (authored against sha256:6a77e71f01e80b19, 2026-09-06), in the golden path's order. `mechanism`
// explains the React/Tailwind mechanism the region demonstrates; `source` is the scene's own code;
// `inAscent` cites the real Ascent file that already realizes the technique; `deviation` names where
// Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "pagination",
    title: "Pagination",
    mechanism:
      "The footer runs both window mechanics behind one request/response contract: all-client pages by offset with a numbered pager (random access over a modest snapshot), all-server walks by keyset with only next and restart. " +
      "The keyset cursor is the ordering tuple of the last delivered row — sort value plus identity — sealed with the column and direction it was minted under, so `decodeCursor` refuses it under any other order and the walk restarts. " +
      "The next-window predicate compares the whole tuple, so rows with equal sort values cannot be skipped or repeated at a boundary. " +
      "The count carries its predicate in the same string, and it is a bound (`50+`) whenever the tier fetched `PAGE_SIZE + 1` instead of paying a full scan. " +
      "Insert a repository while browsing: the walk ledger records which step first delivered each identity and counts a row delivered again on a later step as a repeat — offset repeats one after a refresh, keyset repeats none.",
    source: S.SRC_PAGINATION,
    inAscent: {
      file: "src/lib/db/scans-audit.ts",
      note: "`encodeAuditCursor`/`decodeAuditCursor` seal an `(at desc, id desc)` tuple; `getAuditLog` compares the whole tuple in its `OR`, orders by both terms and fetches `limit + 1` to report `nextCursor` without a count.",
    },
    deviation: "The audit cursor is not bound to its ordering (the sort is fixed, so nothing can replay it under another order today), and the fleet leaderboard (`RepoLeaderboard.tsx`) has no window at all — it mounts every repository the org has.",
  },
  {
    slug: "sorting",
    title: "Sorting",
    mechanism:
      "`COLUMNS` is a column model — id, semantic kind, alignment, the direction a first click chooses — and `compare` is one comparator for both tiers: numbers numerically, text through an `Intl.Collator` with natural numbering, statuses by `STATUS_RANK`, instants as instants, absent values last in either direction, and identity as the final term. " +
      "Because the order is total, the instrument's re-sort of identical data moves zero rows, and a refresh cannot shuffle. " +
      "A header click takes the type's natural direction, a second reverses it, a third returns to the named `DEFAULT_SORT` — never to storage order — and exactly one `<th>` carries `aria-sort`, its control a real focusable button. " +
      "Selection is a set of ids, so ticked rows stay ticked wherever a resort moves them; the sort instrument lists them by identity.",
    source: S.SRC_SORTING,
    inAscent: {
      file: "src/features/standing/repositories/RepoLeaderboardParts.tsx",
      note: "`SortTh` is a real button with `aria-sort`, the cycle is most-first → least-first → the named incoming order, and `activityValue` sends a null-activity row to -1 so absent trails; selection in `useRepoLeaderboard.ts` is keyed by `fullName`, so re-sorting never disturbs it.",
    },
    deviation: "The leaderboard's comparator has no identity tiebreaker — equal activity values fall into `Array.prototype.sort`'s stable-but-incidental order — and its 'default' third state is the server's incoming order rather than a named product sort.",
  },
  {
    slug: "performance",
    title: "Performance",
    mechanism:
      "Rung 0 is the instrument: rows in the store, rows mounted, rows rendered by the last interaction, and how many times the presentation sequence was derived — each a DOM counter written from an effect, never state. " +
      "`PAGE_SIZE` is rung 1; `toVM` formats each delivered row once into plain strings (rung 2) so the cell path only places them; `LedgerRow` is `memo()` keyed by id and handed its own `selected` and `entering` booleans, and its commit effect reports one tick through `onRowRender`, so one checkbox toggle renders exactly one row (rung 3). " +
      "`view` and `rows` are `useMemo` derivations over named inputs — regime, snapshot, query, served — and the derivation counter moves only when one of them does. " +
      "`rungFor(volume)` chooses the rung at runtime from the count the surface was handed, in one place, and refuses rung 4 with its costs written beside it: find-in-page and assistive traversal are not worth mounting fewer than twenty-five rows.",
    source: S.SRC_PERFORMANCE,
    inAscent: {
      file: "src/features/standing/repositories/useRepoLeaderboard.ts",
      note: "`sortedRows` and the visible selection are `useMemo` derivations over named inputs (`rows`, `sort`, `rawSelected`, `rowNames`) — recomputed exactly when one changes, and derived during render rather than pruned back into state by an effect.",
    },
    deviation: "No table row in Ascent is memoized and no table is windowed or paged on the client: `RepoLeaderboardRow` re-renders on every selection toggle, and the fleet leaderboard mounts every repository, so the ladder has never been climbed past rung 2.",
  },
  {
    slug: "loading-and-empty-states",
    title: "Loading and empty states",
    mechanism:
      "The header on `OrgTable` and the controls beside it render first and always; only the `<tbody>` branches, on `bodyState(inFlight, rows, settled, error)`. " +
      "Empty-loading renders eight ghost rows at the real row height under the real columns, widths seeded by position, invisible for their first 150ms in both motion modes so a warm answer never paints a placeholder. " +
      "Populated-refreshing keeps the rows on screen — dimmed through a `[&_tbody]:opacity-60` wrapper with `aria-busy` and a pill in the chrome — and a refresh that fails over rows keeps them and says how many refreshes stale they are. " +
      "Empty-settled is reachable only after the sticky `settled` bit, names its predicate, and offers to clear the filter; error is a `role=\"alert\"` cell in the danger tone with a retry and the preserved query. " +
      "A filter change clears the body (those rows answered another predicate); a sort or page change keeps it dimmed. " +
      "Rows enter with a capped stagger on their first appearance only: `entering` is decided during render against a table-scoped seen-set that the entrance's own `animationend` writes (one delegated native listener; the reduced path is a 1ms epsilon so it still fires) — a resort, a refresh or a page returned to replays nothing.",
    source: S.SRC_LOADING,
    inAscent: {
      file: "src/components/ui/deferPolicy.ts",
      note: "`QUIET_PLACEHOLDER_DELAY_MS = 150` is the same anti-flash window, mirrored in `.reveal-quiet` in globals.css — a placeholder that resolves inside it never paints; the delay stays under reduced motion because it is anti-flash, not decoration.",
    },
    deviation: "`AuditLogTable.tsx` renders a red banner AND falls through to `EmptyState` when a fetch fails with no rows, so error can wear the empty state's clothes; no Ascent table has a geometry-matched ghost body — `PageSkeleton` is page-level.",
  },
  {
    slug: "client-server-split",
    title: "Client–server split",
    mechanism:
      "Two clean regimes share one executor, `runQuery`: all-client holds the snapshot and runs filter, sort and window over it synchronously in a `useMemo`; all-server sends every axis change as a request whose response echoes the query it answered, and a monotonic request id drops any response a newer request superseded. " +
      "The all-client bet is `ALL_CLIENT_BOUND = 5_000`, read by `regimeAllowed`: at 50,000 rows the regime is refused and the chip disables, not tuned. " +
      "The search control tells the truth about scope — 'Filter repositories' over a complete set, 'Search the fleet' as a request, and a separate 'Find in these 25 loaded rows' that narrows the window while the footer keeps the server's count. " +
      "The forbidden knob sorts the loaded page on the client under a server window: header clicks then change a local sort the request never hears, and the region flags the split the moment the header claims an order the window was not cut under.",
    source: S.SRC_SPLIT,
    inAscent: {
      file: "src/features/admin/audit/useAuditLogFilters.ts",
      note: "All-server, cleanly: filter and keyset window are request parameters, the sort is fixed server-side, a monotonic `reqId` drops superseded responses, and the CSV href derives from the last-APPLIED filter so the export never claims a predicate the rows on screen were not produced under.",
    },
    deviation: "The audit response carries no echo of the query it answered — staleness is caught by the client's request id alone — and no Ascent table writes down its all-client growth bound: the fleet leaderboard is all-client with no bound and no guard.",
  },
];
