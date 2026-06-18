# Test Mastery Fix Wave 6 — Server-side tail (auth/IDOR/secrets)

> 7 atomic fix commits, **7 critical findings closed** (cumulative **46 / 60**).
> Suite: **866 → 996 tests (+130), 0 failures.** Baseline preserved: tsc 0 source errors, **0 production source changed** (back to the additive discipline).

## Commits

| Commit | Test file(s) | Finding closed |
|---|---|---|
| `5e4d8ba` | `src/app/api/badge/[owner]/[repo]/route.test.ts` (+6) | badge private-repo disclosure |
| `71abb81` | `recommendations/[id]/route.test.ts` (+12), `events/route.test.ts` (+7) | recommendations IDOR + poisoning |
| `d7bcfe1` | `src/lib/db/scans-shared.test.ts` (+11) | `ensureOrgId` tenant-resolution |
| `771ce73` | `src/lib/live-share.test.ts` (+25) | `live-share` HMAC token |
| `7f601df` | `src/app/api/org/members/route.test.ts` (+13) | members route owner-gate + CSRF |
| `926d056` | `src/app/api/org/export/route.test.ts` (+13) | `/api/org/export` PII gate |
| `0c7fae3` | `src/lib/github/source.test.ts` (+43) | `parseRepoUrl` SSRF |

## What was fixed (the invariant each test now pins)

1. **Badge private-repo gate.** A private-repo report (even from the shared cache fallback) yields the neutral `private` badge and never leaks level/name/score/gate verdict, across default/`?gate`/`?metric=score`; two public cases confirm the gate isn't over-broad.
2. **Recommendations IDOR.** The gate keys on the recommendation's **true owning org** (a body-smuggled `org` is ignored); `updateRecommendation` never called on denial; PUBLIC_ORG poisoning blocked; events GET never reads cross-tenant timelines.
3. **`ensureOrgId`.** Resolves the slug's true org id (never a default/other tenant); a stale/replaced backing row is **dropped** rather than returned as a dangling id (orphan-write guard); cache scoping + P2002 race recovery.
4. **`live-share` HMAC.** Round-trip yields the right org; a sig flip / tampered-payload-with-old-sig / wrong secret / length-mismatch are all rejected; expired rejected, not-yet-expired passes; malformed input rejected without throwing.
5. **Members route owner-gate + CSRF.** A denied owner-role gate → 403 with no membership write; a cross-site POST/DELETE is rejected **before** the gate and any write; outcome mapping (`last_owner`→409) holds with no audit on rejection.
6. **`/api/org/export` PII gate.** Gate-before-read: a denial returns the gate status with the contributor readers **never called** and no PII in the body; RFC-4180 quoting + filename sanitization pinned.
7. **`parseRepoUrl` SSRF.** 43 cases, each accepted result guarded by an `assertSafe` charset invariant; other-host / look-alike / traversal / embedded-credentials / control-char inputs rejected.

## A latent bug surfaced (pinned + flagged, not fixed)

**`parseRepoUrl` host-suffix gap** — the github-host check uses `/github\.com$/` with no left boundary, so `notgithub.com` matches the suffix. The test pins current behavior and flags it as KNOWN, so a future tightening (anchor the host check) is a deliberate, test-visible change. (Impact is limited because the downstream client targets `api.github.com` by extracted `{owner,repo}`, but the validation is looser than intended.)

## Verification

| | After Wave 5 | After Wave 6 |
|---|---|---|
| Test files | 79 | 87 (+8 new) |
| Tests passing | 866 / 866 | **996 / 996** |
| tsc source errors | 0 | **0** |
| Production source files changed | 3 (Wave 5) | **0** |

## Cumulative status

| Wave | Theme | Criticals closed |
|---|---|---:|
| 1 | Cross-tenant auth & IDOR | 11 |
| 2 | Money: charge / refund / reserve / dedup | 9 |
| 3 | Destructive writes & audit atomicity | 7 |
| 4 | Score / verdict integrity math | 8 |
| 5 | Frontend integrity (extraction + SSE) | 4 |
| 6 | Server-side tail (auth/IDOR/secrets) | 7 |
| **Total** | | **46 / 60** |

## Patterns established (catalogue items 29–33)

29. **assertSafe-on-every-accept.** For a sanitizer, wrap every accepted result in an invariant (owner/repo match a safe charset) so a loosened guard fails even on inputs the test didn't explicitly enumerate. *(parseRepoUrl)*
30. **Gate-before-read ordering probe.** Assert the privileged read/write is never called on a denial AND (allow path) that the gate resolves before the fetch — proves ordering, not just outcome. *(org/export, members, recommendations)*
31. **Cache-reverify / orphan-id guard.** For a cached id resolver, test that a stale/replaced backing row drops the cached id rather than returning a dangling one. *(ensureOrgId)*
32. **Body-smuggle rejection.** Send a request whose body/query carries a foreign org id and assert the gate keys on the resource's true owner, ignoring the smuggled value. *(recommendations)*
33. **Forge-and-expiry matrix for signed tokens.** sig flip, tampered-payload-with-old-sig, wrong secret, length mismatch, expired, not-yet-expired, malformed — the full rejection set for an HMAC/JWT-style gate. *(live-share)*

## What remains

**14 criticals remain** (mostly orchestration / trust-boundary-parse): `app.ts` token-mint/skew, `estimateCoverage` cache-poison, `scan.ts` usage capture + assessment-usability gate, `listGoals`/`plan.ts`, `getPlaybookAdoption` lift, segment-scoped rollup, repo-report cross-repo identity + `parseScanReport`, `/api/health` leak, manifest round-trip, `checkAndAlertRegression` orchestrator (+ throw-safety), `getOrgMovers` baseline. All server-side, pure tests. Plus the 76 Highs.
