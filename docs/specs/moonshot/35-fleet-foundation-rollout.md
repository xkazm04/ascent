# 35 — Fleet foundation rollout with self-provisioned report-back

size L · effort 6 / impact 7 / risk 5 · gate **policy** · lane **W1-H** · wave **1**

## Premise check against the tree (2026-08-29)

Every claim in the finding was re-verified. Three corrections, none fatal:

- **`wiring.ts:350-352` does not exist** — the file is 81 lines. The substance holds: the "set these
  two secrets by hand" copy is at `wiring.ts:18-21` and `:55-57`, and the `scheduled-report` job
  reads both secret names (`:70-71`). Cite `buildConformanceWiring` by name.
- **`buildGettingStartedModel` has six steps and a header comment that still says five**
  (`getting-started.ts:6`, union at `:24`). "Six steps, none is foundation" is right.
- **A conformance score column already exists on `Repository`** (`org-rollup.ts:174`, written by
  `recordConformance`, `org-watch.ts:462`), so the `conformance` step needs **no new model**. This
  shrinks the item.

Verified unchanged: `openFoundationPr` is single-repo (`standard/pr.ts:51`), `pr/` is the only route
under `src/app/api/report/foundation/`, `apply-batch` is the fan-out shape to copy, `reportSkipped`
fires when the secrets are absent (`standard/doctor.ts` `--json` branch), and `telemetry:write` is
both a mintable scope (`org-api-tokens.ts:22`) and exactly what `/api/report/conformance` requires
(`route.ts:138`).

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/standard/pr.ts` — add `openFoundationPrBatch` beside `openFoundationPr` (this file only;
  W1-A owns the rest of `src/lib/standard/**`).
- `src/lib/db/org-api-tokens.ts` — add `ensureOrgApiToken` (reuse-or-mint by name+scope).
- `src/lib/org/getting-started.ts` — two new step ids, two anchors, two predicates.
- `src/lib/db/org-onboarding.ts` — two new fields on `GettingStartedFacts` + their queries.
- `src/components/onboarding/tour/tasks.ts` — two `TASK_COPY` + two `PHASE_LABEL` rows.
- `src/components/onboarding/OnboardingScanStep.tsx` (mount the panel on `done`; 235 LOC today, the
  panel is a sibling file so the 300 cap holds) and `OnboardingFlow.tsx` (pass `foundationOrg` +
  the scanned repo list).
- `src/features/standing/repositories/RepositoriesTab.tsx` — mount the rollout panel (65 LOC).
- `src/features/admin/audit/AuditLogCells.tsx` — three action rows (174 LOC; cap 200).
- `docs/features/onboarding/wizard.md`, `docs/features/github/github-app.md`,
  `docs/features/github/setup.md` (one permission-table row).

**Files to create**
- `src/app/api/report/foundation/pr-batch/route.ts` — the fan-out route.
- `src/app/api/report/foundation/secrets/route.ts` — the report-back provisioning route.
- `src/lib/github/actions-secrets.ts` — public-key fetch + sealed-box encrypt + PUT/DELETE.
- `src/lib/db/org-foundation.ts` — audit-derived fleet rollout status (read-only).
- `src/features/standing/repositories/FoundationRolloutPanel.tsx` (≤200 LOC, `"use client"`).
- `src/components/onboarding/OnboardingFoundationPanel.tsx` (`"use client"`).
- Tests listed under **Tests**.

**Prisma models/columns needed** — **none.** This lane is schema-free: PR results are audit rows,
conformance is the existing `Repository` column, the token is an existing `OrgApiToken`. The §1
matrix already records "audit action only" for #35; hold the schema pass to that.

**Director-owned lines requested at merge**
- `package.json`: add `libsodium-wrappers` (dependency) and `@types/libsodium-wrappers` (dev). See
  *Encryption* below for why no stdlib path exists.
- `src/lib/db/index.ts`: re-export `getFoundationRollout` from `./org-foundation`, and
  `ensureOrgApiToken` from `./org-api-tokens`.
- `context-map.json`: `filePaths` for `src/lib/github/actions-secrets.ts` and
  `src/lib/db/org-foundation.ts` under the GitHub App / Onboarding groups.
- `scripts/docs/feature-doc-map.json`: `src/app/api/report/foundation/**` → `wizard.md` (the
  `src/lib/github/**` glob already covers `actions-secrets.ts`).

**MUST NOT TOUCH**
- `src/lib/standard/wiring.ts`, `doctor.ts`, `manifest.ts`, `spec.ts` — W1-A.
- `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/wire-safe-dates.test.ts`,
  `src/lib/db/index.ts`, `context-map.json`, `feature-doc-map.json` — Class B / Director.
- The Passports matrix and the control matrix UI — W1-A.
- `src/app/api/org/tokens/**` — the mint helper is used server-side only; the token routes stay put.

**Handoffs to other lanes**
1. **W1-A (`wiring.ts`)**: once provisioning ships, `buildConformanceWiring`'s comment should read
   "Ascent can set these for you from the Repositories tab" instead of "set these secrets by hand".
   Copy-only; the workflow already reads the two secret names, so no YAML change.
2. **W1-A (Passports)**: the foundation/report-back column on the Passports capability matrix,
   reading `getFoundationRollout(orgSlug)` shipped here. Dropped from this lane deliberately — §2
   gives W1-A that file.
3. **W3-L (wave 3)**: `RepositoriesTab.tsx` gets one mount line here; L's freshness work lands after
   wave 1 merges, so the overlap is sequential. Flagged for the Director. No alert kind is requested
   from W3-M.

## Goal

A new org goes from first scan to a fleet that self-certifies weekly **in one session**: batch the
foundation PR across the repos just scanned, and provision the two report-back secrets so
`node .ai/doctor.mjs --json` actually reaches Ascent instead of printing `reportSkipped`.
*Competitive angle:* Factory's remediation PRs are "coming soon" and its org view is one number; a
one-click fleet install of a vendor-neutral standard **plus** a self-reporting CI probe is the
Scorecard lesson (the Action, not the badge) executed end to end.

**Known gaps deleted in this PR**
- `docs/features/onboarding/wizard.md` → the done-phase description (`:48`) and the "the done phase
  no longer carries an activation checklist (W6b)" note (`:125`) both assert the wizard hands off
  with nothing installable. Rewrite, and add the two new steps to the checklist section (`:195`).
- `docs/features/github/setup.md:25-31` permission table — add the **Secrets** row.
- `docs/features/github/github-app.md:156-162` "Known gaps" — no gap is deleted (none covers this);
  the permission row and a "report-back provisioning" subsection are added.

## Behaviour

### Data model

No new tables. Three new audit actions on the existing `AuditLog` (via `recordOrgAudit(action, slug,
meta, actorLogin)`, `scans-audit.ts:58`):

| action | meta |
|---|---|
| `foundation.batch_opened` | `{ repos: number, opened: number, failed: number, skipped: number }` |
| `foundation.reportback_provisioned` | `{ repo, tokenPrefix, secrets: ["ASCENT_CONFORMANCE_URL","ASCENT_CONFORMANCE_TOKEN"], reusedToken: boolean }` |
| `foundation.reportback_revoked` | `{ repo, secrets: [...], removed: number }` |

The **raw token is never in a meta row** — only `tokenPrefix` (`askl_` + 7 chars), matching
`org-api-tokens.ts`'s capability model. The batch writes one `foundation.pr_opened` per repo as well,
so the rollout read sees batch and single installs identically.

`getFoundationRollout(orgSlug): Promise<FoundationRolloutRow[]>` (new `src/lib/db/org-foundation.ts`)
reads `AuditLog` for those three actions on the org and joins the org's `Repository` rows:

```ts
export interface FoundationRolloutRow {
  repo: string;                       // "owner/name"
  foundationPrAt: string | null;      // ISO — wire-safe (never a Date)
  reportBackAt: string | null;        // ISO, null once revoked
  conformance: number | null;         // Repository column; null = never reported, NOT 0
  conformanceAt: string | null;
}
```

**Honest-null**: `conformance: null` renders as `—` ("never reported"), never `0%`. `reportBackAt:
null` renders "not provisioned", never "off". Both are stated in the panel's own legend.

### Encryption (why a dependency)

GitHub Actions secrets require **libsodium `crypto_box_seal`** (X25519-XSalsa20-Poly1305) against the
repo's public key. `node:crypto` has X25519 but no XSalsa20/Poly1305, so there is no stdlib path;
`libsodium-wrappers` (WASM, the octokit-documented choice) is the minimal addition. The module keeps
sodium behind one `await sodium.ready` inside `encryptSecret` so nothing loads at import time —
important because `next build` traces this file from a route (`build-not-in-gate`).

### Modules

`src/lib/github/actions-secrets.ts` (layered on `githubAppFetch`, like `github/write.ts`):

```ts
export interface RepoSecretPublicKey { key_id: string; key: string }
export async function getRepoSecretPublicKey(token, owner, repo): Promise<RepoSecretPublicKey>;
export async function encryptSecret(publicKeyB64: string, value: string): Promise<string>;
export async function putRepoSecret(token, owner, repo, name: ConformanceSecretName, value: string): Promise<void>;
export async function deleteRepoSecret(token, owner, repo, name: ConformanceSecretName): Promise<void>;
export const CONFORMANCE_SECRETS = ["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"] as const;
export type ConformanceSecretName = (typeof CONFORMANCE_SECRETS)[number];
```

The **name allowlist is in the type**: only those two names are writable, so no call site — present
or future — can put an arbitrary secret into a customer repo. A missing `secrets: write` permission
surfaces as `AppApiError` 403 → "The installation lacks Secrets write access. Update the GitHub
App's permissions." (the `pr-route.ts:23` shape).

`src/lib/standard/pr.ts`:

```ts
export interface FoundationBatchItem { repo: string; ok: boolean; url?: string; number?: number;
  reused?: boolean; committed?: number; skipped?: string[]; error?: string }
export async function openFoundationPrBatch(input: {
  token: string; owner: string; base?: string; concurrency?: number;
  repos: Array<{ name: string; files: GeneratedFile[]; prTitle: string; prBody: string }>;
}): Promise<FoundationBatchItem[]>;
```

Bounded by `mapPool(…, SCAN_CONCURRENCY, …)` (`src/lib/pool.ts:14,37`). One repo's failure never
aborts the pool (per-worker try/catch, `classifyPrWriteError` for the message) — the `apply-batch`
contract, verbatim. `FOUNDATION_BRANCH` is unchanged, so a re-run updates the same PR per repo.

`src/lib/db/org-api-tokens.ts`:

```ts
export async function ensureOrgApiToken(orgSlug, opts: { name: string; scopes: SkillTokenScope[]; createdBy?: string | null })
  : Promise<{ token: string | null; summary: ApiTokenSummary; reused: boolean } | null>;
```

A reused token's raw value **cannot** be recovered (only its hash is stored), so `token` is `null`
there. Consequence, stated in the route: provisioning always mints a **new** token named
`conformance report-back` scoped `["telemetry:write"]` and revokes the previous one of that name —
the value written into the repo secret is always one Ascent just produced and never re-read.

### Routes

| Method · path | Auth | Body → response |
|---|---|---|
| `POST /api/report/foundation/pr-batch` | db+App configured · `requireSameOrigin` · signed-in · `readableOrgForOwner` ≠ `PUBLIC_ORG` · **`requireOrgRole(org, "admin")`** | `{ org, repos: string[], base? }` → `{ results: FoundationBatchItem[], attempted, skipped }` |
| `POST /api/report/foundation/secrets` | same chain, but **`requireOrgRole(org, "owner")`** + `confirm === "<owner>/<repo>"` | `{ org, repos: string[], confirm }` → `{ results: [{ repo, ok, error? }], tokenPrefix }` |
| `DELETE /api/report/foundation/secrets` | same as POST (owner + typed confirm) | `{ org, repos: string[], confirm }` → `{ results, removed }` |

Notes binding all three:
- **One org per batch**, `MAX_BATCH = 25`, deduped before the cap — `apply-batch`'s contract (repeat
  repos race the same branch and burn a cap slot). These are `owner/name` routes, not `[id]` routes,
  so `id-routes-gated.test.ts` does not apply; the org is still resolved from the owner and gated.
- **Owner, not admin, for secrets.** Writing a credential into a customer repo has a larger blast
  radius than a draft PR and is the one action here that takes effect without review. Typed
  confirmation of the full `owner/repo` (one repo per confirmation; the array lets the panel loop)
  matches the destructive-action pattern elsewhere in the app.
- **Reversible**: `DELETE` removes both secrets *and* revokes the token — nothing Ascent wrote
  survives it.
- `ASCENT_CONFORMANCE_URL` is derived server-side from the request origin, never from the body: a
  caller must not be able to point a customer repo's CI at a host of their choosing.

### UI surfaces

**Repositories tab** — `FoundationRolloutPanel` (`@/components/ui` `Tile`, `Button`, `Badge`,
`ConfirmDialog`; `LEVEL_HEX`/`scoreHex` untouched, no new colour tokens). One row per repo, three
columns: *foundation PR* (link / "install"), *report-back* (provisioned / "—"), *conformance* (`%` or
`—`). Bulk bar "Install the foundation in N repos" → `pr-batch`; per-row "Set up report-back" →
typed-confirm dialog → `secrets`. It carries **both `data-tour` stamps** —
`data-tour="foundation-rollout"` on the bulk bar, `data-tour="conformance-reported"` on the
conformance header — so `anchors.test.ts` (which fails on a declared-but-unstamped anchor) passes
without this lane editing another lane's component.

**Wizard done phase** — `OnboardingFoundationPanel` beside `InvitePanel`, gated the same optimistic
way (rendered on the App path; a non-admin gets the route's 403 rather than a prefetched role). Copy:
"Install the `.ai/` foundation in the N repos you just scanned", a disclosure line naming the two
secrets and the App permission, and a no-op "Skip".

**Getting-started checklist** — two new steps:

| id | phase | tab | anchor | done when | available |
|---|---|---|---|---|---|
| `foundation` | `foundation` | `repositories` | `foundation-rollout` | `facts.foundationInstalled` | `!personal && can(role, "admin")` |
| `conformance` | `conformance` | `repositories` | `conformance-reported` | `facts.conformanceReported` | `!personal && can(role, "admin")` |

Ordered after `registry`, before `loop` (install → report → instrument). New facts on
`GettingStartedFacts`: `foundationInstalled` (≥1 `foundation.pr_opened` audit row for the org) and
`conformanceReported` (≥1 org `Repository` with a non-null conformance score). Both are false in
`EMPTY_GETTING_STARTED_FACTS`. Personal workspaces have no installation token and no fleet, so both
are `available: false` and never block `allDone`.

### Self-hosted · plan gates · privacy

- **No plan gate.** The foundation install is the product's own adoption path; gating it by tier
  makes the T2 loop purchasable rather than default. `selfHosted()` therefore changes nothing — which
  is the point: a self-hosted install provisions report-back to *its own* origin, identically.
- Both routes require the App (`isAppConfigured`); without it the panel does not render and the
  SKILL.md download (`/api/report/skill`) stays the documented fallback.
- No public surface and no cohort statistics, so `CHAMPION_MIN_POP` does not apply. Everything
  written is `AuditLog` rows plus one `OrgApiToken`, both already covered by the org purge path.

## Build order

1. **`actions-secrets.ts` + unit test** — no route, no UI; gateable alone (needs the
   `libsodium-wrappers` line from the Director first).
2. **`openFoundationPrBatch`** in `standard/pr.ts` + test. No caller yet.
3. **`POST /api/report/foundation/pr-batch`** — reuses `requirePrWriteContext` and `buildFoundation`
   per repo (a repo with no saved scan is `ok:false, error:"No saved scan"`, never an abort); writes
   `foundation.pr_opened` per repo plus one `foundation.batch_opened`.
4. **`ensureOrgApiToken`** + `POST`/`DELETE /api/report/foundation/secrets`: owner gate, typed
   confirm, origin-derived URL, audit rows, revoke-on-delete.
5. **`getFoundationRollout`** in `src/lib/db/org-foundation.ts` (+ the requested barrel line).
6. **`FoundationRolloutPanel`** on the Repositories tab, with both `data-tour` stamps.
7. **Getting-started**: facts, two steps, anchors, `TASK_COPY` rows.
8. **Wizard done phase**: `OnboardingFoundationPanel` + its two props through `OnboardingFlow`.
9. **Docs + audit labels**: `wizard.md` (done phase, checklist, the two steps), `github-app.md`
   (report-back subsection + permission row), `setup.md` (Secrets row), `AuditLogCells.tsx`.

## Tests

**New**
- `src/lib/github/actions-secrets.test.ts` — sealed-box round-trip against a test keypair (decrypt
  with `crypto_box_seal_open`); the name allowlist rejects any other name *at the type level*
  (`@ts-expect-error`, enforced by `tsc`); a PUT 403 surfaces as `AppApiError` status 403.
- `src/app/api/report/foundation/pr-batch/route.test.ts` — mirrors `practices/apply-batch`: mixed-org
  batch → 400; non-admin → denial; duplicates deduped before `MAX_BATCH`; one repo throwing leaves
  the others `ok:true`; a repo with no saved scan is `ok:false` and does not abort.
- `src/app/api/report/foundation/secrets/route.test.ts` — **admin is not enough (403)**; wrong
  `confirm` → 400; the URL is the request origin even when the body supplies one; the raw token never
  appears in any `recordOrgAudit` meta; `DELETE` removes both secrets *and* revokes the token.
- `src/lib/db/org-foundation.test.ts` — never-reported → `conformance: null` (not `0`); revoked →
  `reportBackAt: null`; every timestamp is a `string`.
- `src/components/onboarding/OnboardingFoundationPanel.dom.test.tsx` — the disclosure naming both
  secrets and the App permission renders before any request is issued.

**Extended** — `src/lib/org/getting-started.test.ts` (two steps: predicates, personal
`available:false`, the tab/anchor table at `:159-163`, `allDone` unaffected); a `standard/pr` sibling
test for batch concurrency + per-repo isolation; `tour/tasks.test.ts` and `TourChecklist.dom.test.tsx`
(their `Record<GettingStartedStepId, …>` fixtures fail to compile until the two ids are added — the
intended fail-before).

**Fail-before each guard must reproduce** — `anchors.test.ts`: declare the two anchors *without* the
panel stamps and the "every DECLARED anchor is stamped" case must list both. The origin test:
hard-code `body.reportUrl` into the route → assertion fails. The null-conformance test: return `0`
instead of `null` → fails (G4: absence, never a fabricated basis).

**Structural guards** — `id-routes-gated.test.ts` is not applicable (no `[id]` segment).
`wire-safe-dates.test.ts`: `FoundationRolloutRow` is client-imported, so **request its entry from the
schema/Director pass** (this lane must not edit that file). `check-doc-sync` is satisfied by
`wizard.md` + `github-app.md` in the same turn.

**e2e / UAT** — re-run **Sam (staff engineer)**'s first-run journey end to end: install → scan →
done-phase foundation CTA → rollout panel → report-back provisioned → conformance column populated.
Dana's briefing journey (M1) is untouched (no `briefing.ts`, no PDF).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (the two new
`src/features/**` files ≤200; `OnboardingScanStep.tsx` still <300) → e2e (UI moved). Done when a
3-repo batch opens 3 draft PRs from one click; the doctor's `--json` in a provisioned repo posts a
score that lands on the panel; `DELETE` leaves neither secret nor a live token; and `reportSkipped`
no longer appears for a provisioned repo.

## Out of scope

- **#16 Doctor per-check ledger** (W1-A) — `ConformanceFinding` rows, the control matrix,
  `requireChecks`. This lane consumes only the existing aggregate score.
- **#13 Manifest-as-scan-input** / **#15 Guidance arbiter** — the manifest's *content* is W1-A/W2-I;
  this lane only ships it. **#8 Agent-admission compiler** (W4-O) — rulesets/CODEOWNERS written into
  customer repos; the secrets write here is deliberately narrower (two fixed names, owner-confirmed,
  reversible).
- Deferred deck items this must not absorb: **#6** signed attestation (no DSSE on the report),
  **#21** identity-graph RBAC (the owner gate is the existing `Membership` role), **#24** pooled
  billing (no credit accounting on batch PRs), **#28** durable scheduled drives (the weekly re-check
  stays the repo's own cron), **#37** data-bound deck diagrams. Concept-doc **#2** open benchmark
  corpus — conformance scores stay tenant-private.
