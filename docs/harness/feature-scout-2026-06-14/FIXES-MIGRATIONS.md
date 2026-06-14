# Feature Scout Migrations Session — the 3 deferred schema-change items

> 3 commits, 3 findings closed (STD-1, ALRT-3, MEM-2 — the items Waves 1–2 deferred as migration-only).
> Branch: `vibeman/feature-scout-migrations` (stacked on Wave 2).
> Baseline preserved: `tsc` 0 → 0; **vitest 450/450 → 451/451** (+1: the new `Invite` parity case);
> eslint 0 errors; `next build` ✓; `init-sql` parity 26 → 27.

One mental model: **each item needs a Prisma schema change that can't be live-verified here (DB-less).**
The discipline for every one: edit `schema.prisma` → `npx prisma generate` (offline, so tsc sees the new
fields) → hand-write the `prisma/migrations/<ts>_<name>/migration.sql` → mirror `prisma/init.sql` (the
`init-sql.test.ts` parity test enforces every model has a `CREATE TABLE`) → verify via prisma generate +
tsc + parity test + next build. The migration is applied at deploy time by `prisma migrate deploy`.

## Commits

| # | Commit | Finding | Schema change | What shipped |
|---|---|---|---|---|
| 1 | `fafdd9f` | ALRT-3 | `Organization.alertOverallDrop/alertDimensionDrop Int?` | per-org regression thresholds threaded into `detectRegression`; GET/POST + AlertsControl inputs |
| 2 | `788a527` | STD-1 | `Repository.aiConformance*` (4 nullable cols) | doctor `--json` + auto-report; `POST /api/report/conformance`; `recordConformance`; `.ai N%` chip on the leaderboard |
| 3 | `7e423b6` | MEM-2 | new `Invite` model | invite flow: `invites.ts`, `/api/org/invites`, `/invite/[token]` accept page, MembersPanel invite form + pending list |

## What was fixed

1. **ALRT-3 — Per-org regression thresholds.** `detectRegression` always ran on `DEFAULT_THRESHOLDS`
   (overall 5 / dim 15) though it took a thresholds arg. Added nullable `Organization.alertOverallDrop`
   / `alertDimensionDrop`, `getOrgAlertThresholds`/`setOrgAlertThresholds`, and threaded them through
   `checkAndAlertRegression` (per-field fallback to the defaults). `GET/POST /api/org/alerts` now
   read/write them (audited `org.alerts.thresholds`); `AlertsControl` gained overall/dimension inputs.
2. **STD-1 — Close the `.ai/` conformance loop.** The doctor computed a conformance % and told users to
   "re-scan in Ascent", but nothing ingested it. Now `node .ai/doctor.mjs --json` prints a machine
   summary and auto-POSTs (with `ASCENT_CONFORMANCE_URL` + `_TOKEN`, e.g. in CI) to
   `POST /api/report/conformance`, which records it onto the Repository row
   (`aiConformance`/`Fails`/`Warns`/`At`, all nullable, via no-op-safe `recordConformance`), gated by a
   CI token or org ownership. `getOrgRollup` surfaces it and the repositories leaderboard shows a
   colour-coded `.ai N%` chip — the adopt→verify→re-score loop closes in-app.
3. **MEM-2 — Member invite flow.** Replaces "owner types an exact login (typo = ghost membership)" with
   a real flow: a new `Invite` model (single-use token, optional pinned login/email, 7-day expiry),
   `invites.ts`, owner-gated `/api/org/invites` (POST/GET/DELETE, audited), an `/invite/[token]` accept
   page (signed-out → sign-in wall; pinned-login invites refuse anyone else), and an invite form +
   pending-invites list in the Members panel.

## Verification (before → after)

| Gate | Baseline | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 450/450 | 451/451 (+1 Invite parity case) |
| `init-sql` parity | 26/26 | 27/27 |
| eslint (changed) | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |

**Migrations were NOT run against a live DB** (this repo runs DB-less; `prisma migrate dev` needs a
live DB). All three are additive — two add nullable columns, one adds a new table — so a deploy's
`prisma migrate deploy` applies them safely. The hand-written migration SQL matches what
`migrate diff` would produce and the `init.sql` mirror keeps a plain `psql -f` bootstrap correct.

## Patterns established (catalogue additions, items 8–9)

8. **Offline migration discipline (DB-less repo).** Edit schema → `prisma generate` (so tsc sees new
   fields) → hand-write `migrations/<ts>_<name>/migration.sql` → mirror `init.sql` → verify via
   generate + tsc + the `init-sql` parity test + `next build`. Note in the commit that no live DB
   migration ran; deploy applies it. Additive-nullable / new-table changes are safe to defer-verify.
9. **The `init-sql.test.ts` parity test is the schema-drift guard.** Every `model` must have a
   `CREATE TABLE "<Model>"` in `init.sql` and the table set must equal the model set — so a new model
   needs both the migration AND the init.sql block, and the test catches a forgotten mirror.

## Deferred-items ledger — now CLOSED

- ~~STD-1~~ ✓ `788a527` · ~~ALRT-3~~ ✓ `fafdd9f` · ~~MEM-2~~ ✓ `7e423b6`. The follow-ups file's three
  "DEFERRED" entries are resolved by this session.

## What remains (from the INDEX)

Waves 3–8 + the optional tail are still open: notifications/email (GOAL-1/SEC-4/EXEC-1/ALRT-2/OVR-2),
monetization (CRED-1/QUOTA-1), planning completeness, live ops, audit/compliance + CI gate, growth/SEO
+ onboarding, and the 49 mediums / 4 lows.
