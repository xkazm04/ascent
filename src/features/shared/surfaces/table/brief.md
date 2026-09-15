# Table - showcase brief

subject: table
subcategory: data-display
digest: sha256:6a77e71f01e80b19
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/table/table.md

Read: the golden path, all five techniques (`pagination`, `sorting`, `performance`,
`loading-and-empty-states`, `client-server-split`), the three applications
(`react--client-server-split`, `react--performance`, `rust--pagination`), the four laws cited
(`identity-survives-reuse`, `count-carries-predicate`, `derivation-names-recomputation`,
`failure-not-empty-success`), the reference scene `motion/` and `BRAND.md`.

## Scene concept

One fictional fleet ledger — a table of repositories with level, score, commits, status and last
scan — that a viewer can use for a minute as a product surface: filter, sort by a header, page, tick
rows, refresh, and break it on purpose. The toolbar is the client/server split (two regimes, one
executor, a written-down growth bet), the ledger itself is the body state machine under chrome that
never unmounts, the footer is the window (offset with a pager, keyset with a sealed cursor, a count
that carries its predicate), and two instruments read the order contract and the performance ladder
off the same live state. `reduced` and `volume` come from props; the fleet is keyed on `volume`, so
a new volume is a new surface with its own first arrival, seen-set and bet.

Layout: toolbar → ledger → footer → (sorting instrument | performance instrument). Rail order is the
golden path's: pagination, sorting, performance, loading-and-empty-states, client-server-split.

## Techniques

### pagination
- use_when matched: "rows skipped or repeated where sort values collide"
- mechanism to show: `runQuery` (ledger.ts) implements offset and keyset behind one contract; the
  keyset cursor is `[col, dir, value, id]` sealed and refused under another order; the next-window
  predicate compares the whole tuple; `total` is exact only when the scan is paid, else `{hasMore}`
  and the footer prints `50+`; the count string carries the predicate; the walk ledger
  (`useLedger.ts`) counts a row re-delivered on a later step as a repeat — "insert a repository"
  then refresh + page 2 repeats one under offset, "next" repeats none under keyset.
- region: `LedgerFooter.tsx` → `FooterRegion`
- Ascent evidence: `src/lib/db/scans-audit.ts` — `encodeAuditCursor`/`decodeAuditCursor` over
  `(at desc, id desc)`, whole-tuple `OR` predicate, `orderBy` both terms, `take: limit + 1` for
  `nextCursor` (grep: `rg "cursor" src/lib/db` → scans-audit.ts, kpi-metrics.ts, retention.ts)
- deviation: the audit cursor is not bound to its ordering; `RepoLeaderboard.tsx` has no window
  (mounts every repo)
- applications read: `rust--pagination.md` — the composite `(created_at, id)` tuple predicate and
  the head-vs-origin seeding rule (mechanism only; the walk here always seeds at origin because the
  job is browsing, said in the footer copy). Nothing cited as Ascent's.

### sorting
- use_when matched: "rows shuffle on refresh with unchanged data"
- mechanism to show: `COLUMNS` column model with semantic kind + first direction; `compare` — typed
  (`Intl.Collator` natural, numeric, `STATUS_RANK`, instants), absent last in either direction,
  identity as the last term; header cycle type-direction → reverse → `DEFAULT_SORT`; exactly one
  `aria-sort` on a real button; selection is a set of ids; the instrument re-sorts identical data
  and reports rows moved (0), ties on the page, absent count, selected ids.
- region: `SortInstrument.tsx` → `SortRegion` (the header buttons live in the ledger region; the
  instrument is where the contract is read)
- Ascent evidence: `src/features/standing/repositories/RepoLeaderboardParts.tsx` — `SortTh` with
  `aria-sort` + a real button, `activityValue` → -1 for absent; `useRepoLeaderboard.ts` selection
  keyed by `fullName` (grep: `rg "aria-sort" src` → 4 hits: TeamsMatrixSortTh, RepoDimensionHeatmap,
  RepoLeaderboardParts, SecurityRiskRegisterParts)
- deviation: no identity tiebreaker in the leaderboard comparator; the third cycle state is the
  incoming server order, not a named product default
- applications read: `react--client-server-split.md` — the default comparator being stringly and
  `reverse()` inverting tie order (a defect to avoid; mechanism, not Ascent evidence).

### performance
- use_when matched: "one selection toggle repaints every row"
- mechanism to show: `LedgerRow` is `memo()` keyed by id, handed its own `selected`/`entering`
  booleans; its commit effect calls `onRowRender`, which writes a DOM render counter
  (`log.current.el.textContent`) — a toggle renders exactly one row; `toVM` formats once per delivery (`useMemo` on `l.rows`); `view`/`rows` are `useMemo`
  derivations over named inputs with a derivation counter; `rungFor(volume)` picks the rung at
  runtime in one place and refuses rung 4 with its costs named.
- region: `PerfInstrument.tsx` → `PerfRegion`
- Ascent evidence: `src/features/standing/repositories/useRepoLeaderboard.ts` — `sortedRows` and
  the visible `selected` set as `useMemo` derivations over named inputs (grep: `rg "memo\("
  src --glob "*.tsx"` → 0 hits: no memoized row anywhere; `rg "useVirtualizer|react-window"
  src package.json` → 0 hits)
- deviation: no memoized table row, no client windowing or paging; the ladder stops at rung 2
- applications read: `react--performance.md` — the runtime rung selection keyed on the live count
  and the negative (three ladders, no call site): taken as "one decision site, where it cannot be
  skipped" (`rungFor` is called by the instrument that displays it). Nothing cited as Ascent's.

### loading-and-empty-states
- use_when matched: "rows replaced by skeletons while refreshing"
- mechanism to show: `bodyState()` (ledger.ts) over `inFlight, rows, settled, error`; chrome
  (`OrgTable` head + controls) unconditional; `GhostRows` geometry-matched, seeded widths, 150ms
  invisibility in both modes; refreshing dims rows via `[&_tbody]:opacity-60` + `aria-busy` + a
  chrome pill; a failed refresh over rows keeps them with a stale pill; empty-settled names the
  predicate and offers "clear the filter"; error is `role="alert"` + retry + preserved query; filter
  change clears, sort/page change keeps; entrance guarded by a table-scoped seen-set (state) read
  during render and written by one delegated native `animationend` listener (reduced = 1ms
  epsilon so it still fires).
- region: `LedgerTable.tsx` → `LedgerRegion`
- Ascent evidence: `src/components/ui/deferPolicy.ts` — `QUIET_PLACEHOLDER_DELAY_MS = 150`
  mirrored by `.reveal-quiet` in `globals.css` (grep: `rg "reveal-quiet" src/app/globals.css` →
  the utility and its reduced-motion partner)
- deviation: `src/features/admin/audit/AuditLogTable.tsx` shows an error banner AND falls through
  to `EmptyState` on a failed fetch with no rows (error wearing empty's clothes); no
  geometry-matched ghost body in any Ascent table (`PageSkeleton` is page-level)
- applications read: `react--client-server-split.md` — eight geometry-matched ghost rows under an
  always-rendered header with a ≥120ms delay, the "no error state" shortfall (mechanism + a
  failure to avoid; nothing cited as Ascent's).

### client-server-split
- use_when matched: "a sort that only reorders the loaded page"
- mechanism to show: two regimes, one executor; all-client = held snapshot + synchronous `useMemo`
  query; all-server = every axis a request with `echo`, latest-wins `reqId`; `ALL_CLIENT_BOUND =
  5_000` read by `regimeAllowed` — at 50,000 the all-client chip is disabled ("bet expired");
  honest search labels ("Filter repositories" / "Search the fleet" / "Find in these 25 loaded
  rows"); the forbidden knob sorts the loaded page locally and the region flags
  `data-split="forbidden"` with the header's claimed order vs the window's.
- region: `SplitToolbar.tsx` → `SplitRegion`
- Ascent evidence: `src/features/admin/audit/useAuditLogFilters.ts` — all-server filter + keyset
  window, fixed server sort, monotonic `reqId` dropping superseded responses, CSV href from the
  last-applied filter (grep: `rg "hasMore|nextCursor" src` → audit route + viewer + scans-audit)
- deviation: the audit response carries no echo; no Ascent table writes down an all-client bound
  (the fleet leaderboard is all-client with no guard)
- applications read: `react--client-server-split.md` — `onEndReached` + sortable columns as the
  forbidden split, the "find in these results" hybrid, the request/response echo (mechanisms only).

## Out of the read

- Server-side allowlisting of sortable columns: the scene has no wire, so the allowlist is
  `COLUMNS` itself; not demonstrated as a validation door.
- Persisting the chosen sort per table (a navigational/preference concern) — scenes read no URL
  and no storage by contract.
- Responsiveness (column dropping under a width) — `OrgTable` scrolls the region horizontally
  under `minWidth`, which is the golden path's fallback; no column-priority model is shown.
- Windowed rendering (rung 4) is refused on purpose and said so in the instrument.
