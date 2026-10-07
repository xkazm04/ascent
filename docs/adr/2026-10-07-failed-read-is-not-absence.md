# A failed read is never shown as absence

- **Status:** Accepted, recorded after the fact from code already on `master`.
- **Date:** 2026-10-07
- **Deciders:** App Master `ascent`, through the 2026-10-06/07 council reworks (briefing span, scan span,
  client fallback routes). **The operator did not take this decision.** The reworks reached it and this
  record writes it down so a later ADR can confirm, amend or reverse it. Until then the guards below
  enforce it.

## Constraint

When the database was configured but unreachable, the read layer gave the same answer it gives for
"nothing there", and the UI turned that answer into a statement of fact. Pre-fix parents:

- **Permalink: "never scanned" and a metered "Scan now".** `getScanReportByCommit` ended in
  `dbReadSafe(() => loadScanReportByCommit(...), null)` (`b56fae1e^:src/lib/db/scans-read.ts:1307`).
  `dbReadSafe` resolves its fallback on an unreachable store, and the page mapped that successful `null`
  to `{ kind: "empty" }` (`b56fae1e^:src/app/report/[owner]/[repo]/page.tsx:55`). That rendered
  `ColdScanGate` (`:135`): "never scanned", with an offer to spend a scan. Only a *throw* counted as
  unavailable (`:56`), and an outage does not throw. The history read had the same seam
  (`b56fae1e^:src/lib/db/scans-read.ts:438`).
- **Permalink siblings: empty sections.** Before `f6905be9`, `getSkillHistory().catch(() => [])`
  (`f6905be9^:src/app/report/[owner]/[repo]/page.tsx:147`) hid the skill section as if none was ever
  generated. `getRepoPassport().catch(() => null)` (`:148`) told `ReportView` the server had proved there
  is no passport, so it skipped its own fetch. A recommendations failure became `items: []`, a "real
  answer" the client never refetches.
- **Client fallback routes: "Scan it first", "Baseline established", `items: []`.**
  `4802be0f^:src/app/api/report/passport/route.ts:34` was `.catch(() => null)` followed by a 404 "No
  passport for this repository yet. Scan it first, then export." (`:37`).
  `4802be0f^:src/app/api/history/route.ts:107-114` turned a null history into `scans: []` with status
  200, which `ReportView` renders as the quiet "Baseline established" panel.
  `4802be0f^:src/app/api/recommendations/route.ts:46-47` answered 200 `items: []` on a null read.
- **Briefing span (class A).** `986bd115^:src/app/api/org/repo-dimension/route.ts:38-42` did
  `.catch(() => null)` and answered 404 "No stored scan for this repository."
  `986bd115^:src/app/api/org/program/route.ts:81` stored a null baseline when the header-summary read
  failed. `986bd115^:src/app/api/report/pdf/route.ts:43-45` answered 403 "PDF export is a Pro-plan
  feature." on a failed plan read. The message of `07339c6a` records the shared page telling a sharer they
  had lost access, that a scope no longer existed, or that a link was "revoked", when the read had only
  failed.
- **Still true at head on one surface:** `src/app/trends/page.tsx:100-112` renders "No scans recorded
  yet" for a null or empty history (see Open).

The common shape: a read that *failed* and a read that *answered "no row"* produced the same value, so
nothing downstream could tell them apart and nothing reported the failure.

## Decision

**A failed read is never rendered or answered as absence, and it always leaves a trace.** Every read in
the guarded spans is one of three kinds.

1. **Class A: absence would be read as a fact.** Examples: "never scanned", "no passport", "no history",
   "plan too low", "link revoked", "no baseline". It **fails visibly**: it throws, and the caller shows
   try-again wording or leaves the value *unresolved* so the client does its own fetch. Mechanisms:
   - `dbReadStrict(fn)` (`src/lib/db/client.ts:372`) is the strict twin of `dbReadSafe`. It has the same
     auth-expiry reconnect and retry, but a configured-but-unreachable database throws a typed
     `DbUnavailableError` (`:357`) instead of resolving a fallback. Live-database query errors pass
     through unchanged.
   - Readers in `src/lib/db/scans-read.ts` take an opt-in `strict` option, routed by
     `readSafeOrStrict` (`:450`): `getRepositoryHistory`, `getRepoPassport`, `getLatestRecommendations`,
     `getScanReportByCommit`. Without it they call `dbReadSafe` exactly as before.
   - A non-database failure (a plan read, ledger read or scope read) is not caught into a value. It goes
     to the route's error path.
   - An **unconfigured** database (keyless MVP) is not an outage. It still answers the empty lookup.
2. **Class B: a chrome or best-effort read.** Examples: nav badges, fix-first panel, org metadata, audit
   reads, branding, credit display, role probes, the landing gallery. It **may degrade** to its fallback,
   because a failed optional read costs its section and never the page, but it **must reach the error
   door**: `.catch(degradedRead("what", fallback))` (`src/lib/org/degraded-read.ts`, a `console.warn`
   plus `reportHandledError`). The scan span uses `degradeTo` / `reportDegradedRead` /
   `reportFailedRead` (`src/lib/scan-read-door.ts`). Pure and client modules, where `respond.ts` cannot
   be imported, use a `console.warn`.
3. **Class C: legitimately silent.** Examples: a request-body parse that becomes a 400, a stream cancel,
   browser storage, best-effort telemetry, a scanned repo's own malformed `package.json`. The silence
   stays, with a one-line reason at the site and an entry on the guard's allowlist.

**Which wrapper.** Use `dbReadStrict` (or `strict: true`) when the caller would present null or empty as
a fact, or offer an action on it such as a metered scan. Use `dbReadSafe` where null or empty is benign
or the caller already has its own error door. Use `degradedRead` for a class B read.

**HTTP shape.**
- A failed read on a route answers **503** where 503 is free to mean "dependency failed" (the briefing
  PDF and the class A routes of `54656e27` / `986bd115`), and **500** where 503 already means
  "persistence is off" (history, passport, recommendations: `4802be0f`). The no-database 503 stays a
  quiet answer: `ReportView` exempts 503 from its failed-read warning (`3e49c37d`), so a database-less
  deployment does not log a false failure on every view.
- Either way the failure goes through `reportHandledError` (`src/lib/api/respond.ts`) after a
  `console.error`. Reporting alone is inert without `SENTRY_DSN`, so the door also logs.
- A page that cannot read shows a failure state, `PermalinkReadError` (`b56fae1e`), not `ColdScanGate`.
  A read that succeeded and was empty keeps its specific wording; the tests pin both.

**Guards that keep it in place.**
- `src/lib/scan-silent-catch.guard.test.ts` derives the scan span from `context-map.json`, parses each
  file with the TypeScript AST (comments and strings cannot satisfy it), and fails on any silent catch
  not on an exact-count, reasoned class C allowlist. Seeded violations prove each shape still bites. On
  `master` it found 73 silent sites in 111 files; 26 remained after the sweep, all class C (`e67fe39f`).
  `1c2dc0b8` added the three client-fallback routes.
- `src/lib/org/briefing-silent-catch.guard.test.ts` (`ba16c071`) does the same for the executive-briefing
  span. `.catch(() => <literal>)`, an empty catch, or a bare-return catch without a door fails, and a
  stale allowlist entry fails too.
- `src/lib/scan-queue-silent-catch.guard.test.ts` does the same for the scan-queue and cron paths (both
  `/api/cron/{rescan,probe}` routes, `db/scan-jobs.ts`, `scan-queue-worker.ts`), reusing the briefing
  matcher. Silent sites before / after the sweep: 39 / 0 (cron routes 6 / 0, `scan-jobs.ts` 16 / 0,
  `scan-queue-worker.ts` 17 / 0), allowlist empty. A failed cron step now answers null plus a named `errors`
  entry, and `queueDepth` throws on a failed count instead of answering 0.
- The same guard also covers the three org stream/poll routes (`api/org/import`, `api/org/scan`, `api/org/scan/queue`): 16 silent sites before, 3 after, all class C and allowlisted (a quota-telemetry write and two request-body parses that become a 400). The other 13 are class B through `degradedRead`. `listJobsForRun` is class A (`dbReadStrict`): the queue poll answers 503 on a failed read, and the scan and import routes send `queued` with `queued: null` instead of settling. A failed enqueue or claim gets its own `repo` error frame. `org-rollup.ts`'s two queued/controls reads are class B through `noteReadFailure`.
- `src/lib/scan-read-door.test.ts` pins that each door reaches both a log and `reportHandledError`.
- `*.unreachable.test.ts(x)` (permalink page, history, passport, recommendations) run the real readers
  over the real client wrappers with only Prisma faked, for both a `PrismaClientInitializationError` and
  a driver-adapter `ECONNREFUSED`. `client.strict.test.ts` and `scans-read.strict.test.ts` pin
  `dbReadStrict` and the `strict` option against `dbReadSafe`. Per-module `*.doors.test` files assert the
  degraded value is unchanged and the door is reached.

## Alternatives that lost

1. **Degrade every read to empty (the prior default).** Simple, never 5xx. It lost on the evidence above:
   a "never scanned" gate that invites a metered scan during an outage (the G4 failure the page claimed
   to prevent), a stored null programme baseline, a 403 "Pro-plan" refusal on a failed plan read. The
   scan-span sweep found 73 silent sites in 111 files. The default's cost was a false statement, not an
   error.
2. **Fail the whole page on any read error.** Honest, but it makes every optional read an availability
   dependency: a failed nav badge or gallery would take the report or org dashboard down. The sweeps
   class those as B so they keep their value and reach a door. The permalink keeps rendering the report
   when a sibling read fails and leaves that prop unresolved so the client refetches.
3. **Per-site `try/catch` with `console.warn`.** Several sites already did this. It lost because a warn
   nobody reads is not a door: `reportHandledError` alone is inert without `SENTRY_DSN`, a log alone
   pages nobody, and ad-hoc sites drift (the client passport and recommendations warns fired on the
   no-database 503 until `3e49c37d`). The door helpers do both in one tested place.
4. **An error boundary alone.** It catches throws, but this failure does not throw: `dbReadSafe` resolves
   a fallback. Without a typed throw (`DbUnavailableError`) a boundary has nothing to catch, and it
   cannot tell a failed optional read from a failed required one.
5. **Make `dbReadSafe` itself throw.** Fewest concepts, but it changes every existing caller at once
   (org repo-dimension routes, cache tiers, salvage path, badge and gate), most of which are correctly
   class B or benign. `dbReadStrict` is additive: `dbReadSafe` is untouched and the strict opt-in sits
   at the callers that would present absence as a fact (`b56fae1e`).

## Consequences accepted

- **More visible 5xx during a database outage.** History, passport, recommendations and the permalink
  now fail where they used to look empty. That is the intent, and 5xx monitoring will see outages that
  were invisible before.
- **Two read wrappers and a `strict` flag to choose between.** The wrong choice is a silent regression,
  and only the guarded spans have a guard against it.
- **CI fails on a new silent catch in the guarded spans** unless it is a class C site with a reason and
  an updated exact count. A legitimately silent catch now costs a visible allowlist edit.
- **Two wordings per read**: try-again for a failed read, specific wording for a read that answered
  "none". The code carries both paths.
- **503 and 500 are not interchangeable across routes.** On history, passport and recommendations 503
  means "no database", so a failed read there is a 500. Unifying them means revisiting `3e49c37d`.

## Open, not fixed

Verified at the base of this commit:

- `src/app/trends/page.tsx:100-112` still reads history through the default reader (no `strict`) and
  renders "No scans recorded yet" for a null history, so a database outage on the trends page still
  reads as absence.
- `src/components/report/ReportView.tsx` only `console.warn`s on a failed passport or recommendations
  read: the 5xx branches at `:103` and `:163`, the thrown-fetch branches at `:106` and `:167`. The brief
  cited `:106` and `:164`; the second has drifted to `:167`. This is a log, not a reported door, so the
  server fails visibly but the client does not report it.
- Code outside the four council contexts in `context-map.json` and the briefing span is covered by
  neither silent-catch guard; the rule holds there by convention only.

## Related

`docs/features/data/data-model.md` (`dbReadSafe` vs `dbReadStrict`), `docs/features/reporting/report.md`
(G4, the client fallback routes), `docs/features/scanning/scan.md` (the sweep, the three classes, the
guard), `docs/features/org-planning/plan.md` and `docs/features/org-dashboard/org-intelligence.md`
(briefing span). Commits: briefing `54656e27`, `07339c6a`, `ba16c071`, `986bd115`; scan `f6905be9`,
`b56fae1e`, `3e49c37d`, `e67fe39f`; client fallback `4802be0f`, `1c2dc0b8`, `37a1a802`.
