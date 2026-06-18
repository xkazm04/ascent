# Test Mastery Fix Wave 1 — Cross-tenant auth & IDOR boundaries

> 7 atomic fix commits, **11 critical findings closed** (of 60).
> Suite: **509 → 592 tests (+83), 0 failures.** Baseline preserved: tsc 0 source errors.
> Method: each test file authored + self-verified by an isolated subagent (no git, no source edits); orchestrator ran the full suite + tsc centrally and committed each atomically. **Zero production source changed** — every Wave-1 gate was testable as written.

## Commits

| Commit | Test file(s) | Findings closed | Sev |
|---|---|---|---|
| `8ecd6ec` | `src/lib/auth.test.ts` (+22) | github-oauth-session #1 `readableOrgForOwner`, #2 `isSameOrigin`, #3 session-state | 3C |
| `4405012` | `src/app/api/app/webhook/route.test.ts` (+9) | github-app-installation #1 `installationMatchesOwner` | 1C |
| `9b6cfb0` | `src/lib/db/scans-audit.test.ts` (+9), `src/app/api/audit/route.test.ts` (+7) | security-posture #1 `getAuditLog`, #2 `/api/audit` gate | 2C |
| `377b4e5` | `src/app/api/usage/route.test.ts` (+6) | usage-metering `/api/usage` IDOR | 1C |
| `c1ea652` | `src/app/api/report/pdf/route.test.ts` (+11) | pdf-llm #1 gate-then-fetch, #2 failure branches | 2C |
| `5237651` | `src/app/api/history/route.test.ts` (+8) | trends-comparison `/api/history` org-scoping | 1C |
| `e3467b0` | `src/lib/db/segments.test.ts` (+14) | repositories-segments #1 tag org-scoping | 1C |

## What was fixed (the invariant each test now pins)

1. **Auth core (`auth.ts`).** `readableOrgForOwner` denies a non-member (returns `"public"`, never the private slug); `isSameOrigin` rejects cross-site/port-mismatch/unparseable Origin and falls **closed** when `sec-fetch-site` is absent; the session state machine treats a revoked / version-mismatched token as expired and does **not** extend a spent token on a DB blip.
2. **Webhook token-mint gate.** `getInstallationToken` fires **only** on a verified owner↔installation match; it is asserted **not** called on a stored-id mismatch (forged victim id), a DB-lookup error (fail-closed), or a GitHub-account mismatch — so the old fail-open `.catch(()=>null)` shape can never come back green.
3. **Audit read path.** `getAuditLog` puts the **resolved** org id in `where.orgId` and uses the decoded keyset cursor verbatim; `/api/audit` returns the `requireOrgRead` denial verbatim with `getAuditLog` **never called**, on **both** the JSON and `format=csv` branches.
4. **`/api/usage` IDOR.** The gate runs before the read: a non-member → 403 with `getUsageSummary` never called; the `?org=public` short-circuit is pinned.
5. **PDF export (gate-then-fetch).** The `orgSlug` from `readableOrgForOwner` is **captured off** the `getScanReportByCommit` call and asserted equal to the gated value (member→`acme`, non-member→`public`, never the raw owner) — the single most dangerous IDOR refactor on this route is now caught. Plus 404/500 branches leak no private content or raw stack.
6. **`/api/history` org-scoping.** The resolved slug flows unchanged into `getRepositoryHistory`; a non-member of a private org is downgraded to `"public"` and never queried with the private slug (empty `scans`, no row leak); CSV export carries the same resolved slug.
7. **Segment tagging org-scoping.** `setRepoSegment`/`setRepoSegmentsBulk` carry the resolved `orgId` into the segment lookup; a caller in org A targeting org B's segment gets `false`/`-1` with **no** `upsert`/`createMany`/`deleteMany` ever called.

## Verification

| | Baseline | After Wave 1 |
|---|---|---|
| Test files | 57 | 62 (+5 new, 3 extended) |
| Tests passing | 509 / 509 | **592 / 592** |
| tsc source errors | 0 | **0** |
| Production source files changed | — | **0** |

## Cumulative status (Wave 1 of planned 6 critical waves)

| Wave | Theme | Criticals closed |
|---|---|---:|
| 1 | Cross-tenant auth & IDOR | **11 / 20** |
| 2–6 | money / destructive-writes / score-math / frontend / coverage-gate | pending |

**11 of 60 criticals closed.** Remaining Theme-A (auth/IDOR) criticals not in this wave: badge private-repo disclosure, `app.ts` token-mint expiry-skew/self-heal, segment-scoped rollup leak, repo-report cross-repo identity, `/api/recommendations` IDOR, `ensureOrgId` tenant-resolution, `live-share` HMAC token, `/api/org/members` owner-gate, `/api/org/export` PII tenant gate, `parseRepoUrl` SSRF — these fold into later waves or a Theme-A second pass.

## Patterns established (catalogue items 1–6)

1. **Gate-then-fetch org-threading assertion.** For any read gated by an org resolver, capture the org argument actually passed to the data fetch and assert it `===` the gated value — not merely that an allow path returns 200. This catches the highest-blast IDOR refactor (fetching with a default/owner org behind a passing gate). *(pdf, history)*
2. **Reject-path "dependency-not-called" assertion.** Assert the privileged dependency (token mint, data read, DB write) is **not** called on the deny path. A gate that returns 403 but still ran the read/write is still a leak; only the not-called assertion proves the ordering. *(webhook, usage, audit, segments)*
3. **fakePrisma where-clause capture.** Mock `getPrisma` to a hand-built object of `vi.fn()`s, then assert the `where`/`update`/`findFirst` args **include the resolved org id**. Dropping the scope in a refactor turns the test red — the test pins the tenant boundary, not the query shape. *(audit, segments)*
4. **Route-handler unit test via mocked `next/server`.** `vi.mock("next/server", () => ({ NextResponse: class extends Response { static json(b,i){…} } }))` — extend `Response` (not a bare class) when the route also constructs CSV/304 responses. Import `{ GET }` from `./route`, call with a real `Request`, assert on status + awaited `.json()`. No jsdom needed.
5. **Fail-closed on infra error.** Explicitly test that a DB-lookup throw or unconfigured DB **denies** (no fall-through to a privileged path), distinguishing a real fail-closed from a fail-open that happens to 500. *(webhook, audit)*
6. **Extend, don't replace.** When a partial test file exists (`auth.test.ts`, `segments.test.ts`), append new `describe` blocks and preserve every existing test — the pure-helper coverage and the new gate coverage are both load-bearing.

## What remains

Themes B–G (money, destructive writes, score-math, frontend, coverage-gate) plus the 76 Highs are untouched. Next recommended wave: **Wave 2 — money paths** (`/api/scan` reserve/refund/402, commit-SHA dedup, `grantCredits` idempotency, `rate-limit`/`clientIp`, `mapPool`, `cron/rescan`) — all closable with the fakePrisma + route harness above, no source changes expected.
