# Database Client & Schema — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Client-retirement grace silently doubles the connection footprint the DB_CONNECTION_LIMIT knob promises to cap
- **Severity**: High
- **Category**: trade-off-undocumented
- **File**: `src/lib/db/client.ts:400`
- **Scenario**: In DSQL mode the token rotates roughly every `ttl − margin` (~13 min at defaults). Each rotation (`doRefresh`/`reconnectDb`) swaps in a NEW PrismaClient and keeps the OLD one alive for `RETIRE_CLIENT_GRACE_MS = 300_000` before `$disconnect()`. During that 5-minute overlap, old and new clients each own an independent pool of up to `connection_limit` connections — so an instance's real ceiling is 2× the configured budget for ~38% of every rotation cycle (and worse if a reactive reconnect stacks a third client). Neither `applyConnectionBudget`'s extensive doc block nor the retire comments mention this interaction.
- **Root cause**: The budget knob (finding "#2" in the code's own history) and the lazy-retirement fix were designed independently; the budget doc reasons per-client ("N instances × default pool") while retirement makes clients-per-instance transiently 2. The 300_000 constant also hard-couples to "the cron's maxDuration is 300s" — a value defined in a route file that can drift without this constant following.
- **Impact**: An operator sizing `DB_CONNECTION_LIMIT` to the DSQL per-cluster ceiling ÷ instance count (exactly what the comment tells them to do) can still trip connection refusals under fan-out, precisely during rotations — the same "silent 2 AM outage" class this module exists to prevent. Diagnosis is hard because the steady-state math looks correct.
- **Fix sketch**: Document the 2× transient in the `applyConnectionBudget` doc ("size the budget assuming two live clients per instance") or halve the applied limit during overlap. Derive/assert the grace against the cron `maxDuration` (shared constant or a comment pinning both), and consider `$disconnect()`-ing the retired client early once its token TTL has fully elapsed (its connections are dead weight after expiry anyway).

## 2. init.sql parity test checks column NAMES only — type / NOT NULL / DEFAULT drift stays green
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/lib/db/init-sql.test.ts:75`
- **Scenario**: The generic per-model column check asserts only `tableBody.includes('"${column}"')`. If a regenerated init.sql (or a hand edit) carries the right column with the wrong type, wrong nullability, or a missing/changed DEFAULT — e.g. `"scanCredits" INTEGER` losing its `DEFAULT 0` — every parity test still passes.
- **Root cause**: The suite was built to close the *missing-table/missing-column* class from the 2026-06 drift; attribute parity was never in scope, but nothing records that limit — the file header says init.sql "must mirror" the schema, implying full parity.
- **Impact**: The original incident's second half recurs undetected: the header cites "the credit meter read a missing column as 'out of credits'". A DEFAULT/nullability drift produces the same symptom family (inserts failing NOT NULL, credits initializing NULL) on psql-bootstrapped and PGlite local DBs, with the guard suite green.
- **Fix sketch**: Extend the loop to map Prisma scalar types to expected SQL types (`String→TEXT`, `Int→INTEGER`, `Boolean→BOOLEAN`, `DateTime→TIMESTAMP(3)`, `Float→DOUBLE PRECISION`) and assert `?`-ness ↔ absence of `NOT NULL` plus `@default` ↔ `DEFAULT` presence on each column line. Or state the name-only scope explicitly in the test header so the gap is at least a recorded decision.

## 3. No guard that DSQL_REFRESH_MARGIN_SECONDS < DSQL_TOKEN_TTL_SECONDS — margin ≥ TTL degenerates into perpetual rotation
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/lib/db/client.ts:63`
- **Scenario**: `readDsqlConfig` validates each number independently (`positiveIntOr`) but never their relationship. Set `DSQL_TOKEN_TTL_SECONDS=120` with the default `DSQL_REFRESH_MARGIN_SECONDS=120` (or any margin ≥ ttl) and `tokenIsStale()` (`Date.now() >= expiresAt − margin·1000`) is true the instant a fresh token lands: every `getPrisma()` kicks a background refresh, every `withDb()` awaits a mint, and each mint swaps a client into the 300s retirement queue — an unbounded treadmill of clients and signer calls.
- **Root cause**: The 900/120 defaults are safe together, so the cross-field invariant (`margin < ttl`, with meaningful headroom) was never encoded; `readDsqlConfig`'s contract says it "throws only on a genuine misconfiguration" yet this misconfiguration passes silently.
- **Impact**: A plausible tuning attempt (shorter tokens for security posture) turns into signer throttling, mint-cooldown churn, and pools of pending retired clients (compounding finding 1) — with no error pointing at the cause, only elevated latency and `[db]` refresh logs.
- **Fix sketch**: In `readDsqlConfig`, clamp margin to e.g. `min(margin, floor(ttl/2))` with a one-time `console.warn`, or throw the same actionable way the missing-region case does. One unit test alongside the existing clamp tests pins it.

## 4. `next start` with PGLITE_DATA_DIR silently runs NO-DB — the decision is recorded only in a comment, not at runtime
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/instrumentation.ts:18`
- **Scenario**: The PGlite boot is gated on `NODE_ENV !== "production"` (for NFT-tracing reasons the comment explains well). A developer who runs the documented prod-smoke flow (`next build && next start`) against their local `.pglite` data gets no boot, `isDbConfigured()` false (no DATABASE_URL), and every page renders the empty keyless-MVP state. Nothing is logged; the env var they set is simply ignored.
- **Root cause**: The trade-off (NFT cleanliness vs local `next start` parity) was decided and documented in-code, but the losing path got no observable signal — unlike pglite-boot.ts, which shouts and records `__ascentPgliteBootError` for its failure mode.
- **Impact**: "Prod build works but shows no data" debugging sessions; the empty state is plausible (the app is designed to run DB-less), so the missing boot masquerades as a data problem. Prior scans flagged exactly this "confusing NO-DB build behind one comment" shape in pglite-boot (#5) — this is the same hole one layer up.
- **Fix sketch**: In `register()`, when `dataDir` is set but the production gate skips it, `console.warn("[pglite] PGLITE_DATA_DIR is set but ignored in production builds — use `npm run dev`, or set DATABASE_URL for `next start`")`. One line, zero NFT impact (it references no pglite module).

## 5. PGlite column-drift dead end is deliberate but undiagnosable at runtime — the error never names the cure
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/lib/db/pglite-boot.ts:55`
- **Scenario**: The idempotent re-exec of init.sql fixes new-table/new-index drift, and the comments honestly record that a NEW COLUMN on an existing table still needs a data-dir wipe (a blind ALTER was rejected for good reason). But when that case fires, the developer sees a raw Prisma/Postgres `column "X" does not exist` from some arbitrary query hours later — nothing connects it to "your .pglite dir predates this column; wipe it or hand-ALTER".
- **Root cause**: The reconcile was (reasonably) declared out of scope, but detection was bundled into that decision too — the boot already parses init.sql and has a live `pglite.query`, so it could *notice* the drift cheaply even while refusing to fix it.
- **Impact**: The "dominant foot-gun" the 2026-06 fix targeted survives in column form; each occurrence costs a confused debugging session, concentrated on exactly the machines (long-lived local dirs) least likely to suspect schema drift.
- **Fix sketch**: After `exec(sql)`, probe `information_schema.columns` for each table parsed from init.sql, diff against the file's column lists, and on mismatch log one loud actionable line ("[pglite] table X is missing columns [a, b] added after this data dir was created — wipe PGLITE_DATA_DIR or ALTER manually") and/or set `__ascentPgliteBootError`. Detection only; the no-auto-ALTER decision stands.
