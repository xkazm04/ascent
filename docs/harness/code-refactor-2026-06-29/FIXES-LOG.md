# Code Refactor — Fix Log (ascent, 2026-06-29)

Branch: `vibeman/code-refactor-2026-06-29` (worktree off HEAD `c8e04c3`).
Baseline preserved: **tsc 0 errors · vitest 2630/2630** (170 files) → grows as tests are added.
One fix-subagent per wave (sequential, no concurrent writers); orchestrator runs the full tsc+vitest gate after each wave.

---

## Wave 1 — Cron auth + CSRF guard dedup (Theme A)

**2 commits · 2 High findings closed · gate: tsc 0 · vitest 2638/2638 (171 files, +8 new).**

| Commit | Finding | What |
|---|---|---|
| `d83bffc` | data-retention #1 (H) | Extracted `requireCronAuth(request)` → `src/lib/cron-auth.ts` (+ unit test); cron `purge`/`digest`/`rescan` routes now call it. Byte-identical behavior (503 on unset secret, 401 on bad cred, Bearer + `?key=` matching, fail-closed on empty). |
| `ca6bdfc` | org-import #1 (H) | `/api/org/active` dropped its local `isSameOrigin` copy and imports the canonical one from `@/lib/auth`. Route still returns its own `{error:"forbidden"}` 403. |

Note: the local `isSameOrigin` was currently byte-identical to canonical (the report said "drifted"; it was a latent drift risk, not active). Still worth deduping so it can't diverge.

---

## Wave 2 — `getOrgId` adoption: rollup family + private `resolveOrgId` (Theme B)

**2 commits · top finding (org-slug→id dup ~35×) partially closed · gate: tsc 0 · vitest 2638/2638.**

| Commit | Finding | What |
|---|---|---|
| `b4ce116` | database #1 / repositories-segments #2 (H) | Deleted the private `resolveOrgId` in `segments.ts` + `plan.ts` (10 call sites → canonical `getOrgId`); `scans-shared.ts`'s exported `resolveOrgId` now delegates to `getOrgId` (kept name for out-of-scope callers). |
| `65e1e5b` | fleet-rollups #1 (H) | Replaced ~17 inline `organization.findUnique({where:{slug}})→id` lookups across `org-rollup/insights/signals/contributors/teams` with `getOrgId`. |

Verified `getOrgId` semantics: `isDbConfigured()` guard → `trim().toLowerCase()` slug → `select {id}` → `id ?? null`. Behavior-preservation rests on the upstream invariant that slugs are stored & queried lowercased (scan route + auth + install all lowercase). **Left:** `getOrgRollup` (needs full org row for `plan`) — commented.

---

## Wave 3 — `getOrgId` adoption: remaining db modules (Theme B, finish)

**2 commits · org-slug→id dedup (#4) substantially closed · gate: tsc 0 · vitest 2638/2638.**

| Commit | What |
|---|---|
| `326cfca` | `credits.ts` — 3 read-path slug→id lookups → `getOrgId` (billing-sensitive; tx/plan-column reads left). |
| `166af87` | `branding, org-alerts, org-gate, org-llm, org-skills, playbooks, passport-overrides, tech-groups, org-watch, usage` — ~19 more inline lookups → `getOrgId` (+ tech-groups-compare test mock). |

12 files, ~22 lookups total. No import cycle (org-rollup imports only `client`+`org-shared` from the db layer; 10+ modules already import `getOrgId` from it). **Left (correctly):** upsert/create-if-missing sites (`getOrgId` returns null on missing), transaction-scoped reads, and reads needing columns beyond `id` (`getOrgRollup`, branding/gate/alert getters, installations slug→installId).

---

## Wave 4 — `recordOrgAudit` adoption (Theme A, audit)

**3 commits · security-audit #2 + members #1 (H) closed · gate: tsc 0 · vitest 2638/2638.**

| Commit | What |
|---|---|
| `e91d45c` | invites + invites/accept routes → `recordOrgAudit`. |
| `aa3a571` | org config writes (alerts, plan, gate-policy, llm-provider) → `recordOrgAudit`. |
| `55a00b4` | skills/[id] + passport (pr, overrides) writes → `recordOrgAudit`. |

14 files (8 routes + 5 tests + invites pair). 9 audit sites adopted. Verified `recordOrgAudit(action, slug, meta, actorId?)` resolves via `getOrgId`, forwards to `recordAudit`, swallows failures (never throws) — identical to the hand-rolled tail. **Left (correctly):** app/webhook & cron/rescan (their `getOrgId` feeds `checkAndAlertRegression`, not audit) and practices apply/apply-batch (`getOrgId` is an input to `applyPracticeToRepo`, not an audit write).

---

## Wave 5 — PDF theme module + share-token codec (Themes C + D)

**2 commits · 2 High (PDF triplication, share-token dup) closed · gate: tsc 0 · vitest 2638/2638.**

| Commit | What |
|---|---|
| `8881130` | New `src/lib/pdf/theme.tsx` (palette, `scoreColor`, `baseStyles`, `Stat`, `Footer`); adopted in all 3 `pdf/*-document.tsx`. Values diffed first — **per-doc overrides kept** (report-document `h1` 22 vs 24, `rule` margin 16 vs 14). Byte-identical render. |
| `30d84b2` | New `src/lib/signed-share.ts` (`signShareToken`/`verifyShareToken`/`resolveShareSecret`); adopted in `briefing-share.ts` + `live-share.ts`. **Token format unchanged** — each keeps its own secret env var + TTL + payload shape, so issued tokens still verify; timing-safe compare preserved. |

---

## Wave 6 — SSE parser consolidation (Theme E)

**2 commits · 2 High (SSE fragmentation ×4) closed · gate: tsc 0 · vitest 2640/2640 (+2 SSE tests).**

| Commit | What |
|---|---|
| `dcd1aa8` | `lib/sse.ts parseSSE` rewritten to join multi-line `data:` with `\n` (spec) + CRLF-tolerant; was gluing split tokens into fabricated values. Added multi-line + split-token tests. |
| `8c8a1c5` | `ReportClientStatus` deleted its local (correct) `parseSSE`; `useReportScan` now imports the lib parser. Both consumers keep their own reader loops (tail-flush / stall-watchdog). |

`readSSE` + its 5 org consumers untouched (single-line frames parse identically). **Loose end:** `onboarding/importScan.ts` still has its own framing loop (not converted this wave) — candidate for the mop-up.

---

## Wave 7 — GitHub I/O layer consolidation (Theme F)

**3 commits · 2 High (4-way fetch dup, publicBase dup) + path-encoder Med closed · gate: tsc 0 · vitest 2640/2640.**

| Commit | What |
|---|---|
| `aa1b941` | New `ghFetch`/`ghGetJson` in `host.ts` (over `ghHeaders`+`fetchWithTimeout`); `source/governance/discover/list` route through it. `discover` + `list` GAIN the timeout they lacked; each keeps its own typed error mapping + return shape. |
| `4651983` | `webhook` + `scan-alerts` + `cron/digest` drop local `publicBase()` for canonical `publicBaseUrl()` (strict superset: adds the Vercel fallback). |
| `1f6d945` | Centralized `encodePathSegments` (carries `encodeRef`'s rationale); ~5 inline copies routed through it, byte-identical encoding. |

**Left (correctly):** the two GitHub error *classes* (source vs list) — they've provably diverged (list parses `retry-after` + has a 401 case source collapses to UPSTREAM), so not behavior-identical to merge.

---

## Wave 8 — Scoring single-source (Theme G)

**3 commits · 3 High closed · gate: tsc 0 · vitest 2641/2641 (+1).** Two deliberate, drift-fixing behavior changes (flagged).

| Commit | What | Output change |
|---|---|---|
| `b2822e5` | `recomputeRepo` (orgsim) → canonical `overallScoreFor`. | **None** — verified byte-equivalent math; magnitude tests unchanged. |
| `2e1485e` | New `analyze/ai-tools.ts` union vocab; `pulls`/`index`/`passport` derive from it. | **Detection broadens** (union direction only, no narrowing): pulls/index/passport gain gemini/sweep/sourcery/github-actions. Correctness fix. |
| `5edf1f6` | `describeGatePolicy` in `gate.ts`; `policyText`/`gateQuery`/`ciWith`/`policyBits` derive from it. | **PR-comment footer** now includes the D9 floor + `protected branch` it previously omitted (the gate already enforced them). Deliberate; new test pins it. |

---

## Wave 9 — PR-write auth preamble (Theme A4)

**2 commits · 2 High (practices #1, playbooks #1) closed · gate: tsc 0 · vitest 2641/2641.**

| Commit | What |
|---|---|
| `506e812` | New `src/lib/github/pr-route.ts`: `requirePrWriteContext(org)` (install 403 + token mint) + `mapPrWriteError(err,{tag,genericError,conflict?})` (incl. the 409 branch). Adopted across practices/apply, apply-batch, playbooks/[id]/apply, passport/pr. |
| `91db044` | `parseOrgRepo` in `playbook-gate.ts`; playbooks `[id]/repos` + `[id]/apply` share the per-row tenant validation. |

**Kept inline (load-bearing):** each route's App-config 503, session 401, and tenant gate — they run *before* the install gate and their order/messages are observable (folding would change the signed-out message). **Deliberate change (flagged):** playbooks/apply now maps a base-file-collision 409→409 like its siblings (was 502 "write rejected"; its test pinned that as a known bug to flip). **Left:** apply-batch's per-repo worker returns `RepoResult.error` strings (not NextResponse), so `mapPrWriteError` doesn't apply (Medium, out of scope).

---

## Wave 10 — Owner-gated POST preamble (Theme A3)

**1 commit · org-branding #1 (H) closed · gate: tsc 0 · vitest 2641/2641.**

`d27d668` — new `src/lib/api/orgPost.ts` `requireOrgOwnerPost<T>(request, opts?)` (same-origin → parse → require `org` → `requireOrgRole(org,"owner")`, byte-identical responses). **Adopted (5 verbatim handlers):** branding, briefing/share, live-share, llm-provider/test, gate-policy POST. **Left inline (correctly):** plan/members/invites/credits-grant/llm-provider POST interleave field validation *before* the role check (folding would reorder 400-vs-403); alerts uses `admin` not `owner`; llm-provider DELETE's test wholesale-mocks `@/lib/authz`. No test edits.

---

## Wave 11 — Goals/initiatives CRUD preamble (Theme A6)

**1 commit · goals #1 (H) + goals #2 (M) closed · gate: tsc 0 · vitest 2644/2644 (+3).**

`ad67d44` — new `src/lib/api/orgPlan.ts`: `dbGuard`, `invalidTargetDate`, `listOrgRoute`, `createdResponse`, `rowGate`; `plan.ts` twin `get*OrgSlug` now delegate to one private `ownerOrgSlug`. Folded all order-safe pieces; left each route's resource-specific 400s (missing-field / `isGoalMetric` / `isDimensionId` / status whitelist) inline to preserve 400-vs-403 order. **Deliberate change (flagged):** `invalidTargetDate` now runs on initiatives POST+PATCH (`targetDate` is `DateTime?`); bad dates that were silently coerced to null are now rejected — 3 tests added.

---

## Wave 12 — Scan-read tenant scope + select shapes + JSON parsers (Theme B10)

**3 commits · scan-persistence #1 (H) + #2/#3/#4 (M) closed · gate: tsc 0 · vitest 2643 pass + 1 environmental.**

| Commit | What |
|---|---|
| `43f6f77` | `resolveScopedRepo(...)` extracted; 6 readers in `scans-read.ts` adopt it. Cross-tenant guard `orgSlug===DEFAULT_ORG_SLUG && repo.isPrivate` byte-identical; only `getRepositoryHistory` + `getScanReportByCommit` enable it (as before), the other 4 pass it off. |
| `4fc7316` | Hoisted repeated dim-score `select` (×4) + latest-scan `findFirst` (×2) into named consts (HISTORY_POINT_SELECT pattern). |
| `6dc33ac` | `parseStringArray`/`parseDiscrepancies` now build on canonical `parseJson` (hoisted to scans-shared); roadmap mapping reuses `toPersistedRec`. `[]`-on-bad-input fallbacks preserved. |

### ⚠ Environmental test note (NOT a regression)
The full suite shows **1 failure: `client.test.ts` "still fails when no client exists at all (… dsql-signer)"**. Root cause: that test asserts `@aws-sdk/dsql-signer` is **absent** (it is **not** in HEAD's `package.json`), but the worktree's **junctioned `node_modules`** (shared with master's WIP) **physically contains** it, so the dynamic import resolves and `withDb` throws an AWS-credential error instead of the expected "dsql-signer" message. **No wave touched `client.ts`/`getPrisma`/`package.json`** (verified `git log c8e04c3..HEAD --`). On a clean `npm ci` of this branch the test passes. From here the effective gate baseline is **2643 pass + 1 environmental**; any NEW failure beyond this is a real regression.

---

## Wave 13 — Shared UI primitives: DeltaTag (Stat deferred) (Theme H)

**1 commit · score-charts #1 (H) partially closed · design-system #2 (H) DEFERRED · gate: tsc 0 · vitest 2643 pass + 1 env.**

| Commit | What |
|---|---|
| `8332cef` | `DimensionCard` inline ▲/▼ delta → canonical `<DeltaTag hideZero/>`. **Deliberate (flagged):** adds `tabular-nums` the inline copy lacked. |

**Left (correctly):** DeltaTag in chartHover `PointTooltip` (bespoke "since prior" suffix + first-scan/no-change states) and ScoreWaterfall (SVG `<text>` + decimal `fmtPts` + ±0.05 neutral band) — a DOM `DeltaTag` can't express these without new props.

**DEFERRED — design-system #2 (Stat ×5):** the canonical `ui/Stat` hardcodes a Kicker label style and exposes no label-style prop; the 5 inline copies diverge in rendered classes (older `text-sm tracking-widest` label, value-first order, pill `<span>`, responsive sizing + count-up). Adopting would change visuals — out of scope for a visual-preserving refactor. Needs a `Stat` API extension (label-style prop) first → logged as a deferred enhancement, not done.

---

## Wave 14 — Shared UI extraction: status-edit + comparison view (Theme H)

**2 commits · backlog #1 (H) + repositories #1 (H) closed · gate: tsc 0 · vitest 2643 pass + 1 env.**

| Commit | What |
|---|---|
| `73af161` | New `src/components/org/recStatusUi.tsx`: `useSavingIds<E>()` hook + `<StatusSelect>` (option list parameterized). Adopted in BacklogPanel, BacklogItemRow, RecommendationTracker. Status lists `Object.keys(STATUS_LABEL)` vs `REC_STATUSES` were content-identical (no drift) → single-sourced on `REC_STATUSES`. Optimistic update / rollback / 409-refresh preserved. |
| `a8569e7` | New `src/components/org/SegmentComparisonView.tsx` (+ `MetricRow`/`first()`); rendered by segments + tech-stacks pages (only empty-state noun parameterized). Markup/classes identical. |

---

## Wave 15 — DeckSection shell extraction (Theme H)

**1 commit · marketing-about #1 (H) + landing deck-pane (M) closed · gate: tsc 0 · vitest 2643 pass + 1 env.**

`9a60f98` — new `src/components/deck/DeckSection.tsx` (`{id?, variant:"section"|"hero", contained?, className?, containerClassName?}`; classes appended, never replaced). Adopted at **10/11** sites (5 About + 5 landing-prototype), incl. a `hero` variant for AboutHero/IndexHero. The `snap-start…`/hero literals now live solely as DeckSection constants. **Left:** AboutCTA (shell drops `justify-center pb-10` + nests its container differently — not byte-identical). Rendered DOM/classes unchanged at all adopted sites.

---

## Wave 16 — Dead code removal (Theme I)

**4 commits · design-system #1 (H) + database #2 (H) + several M/L closed · gate: tsc 0 · vitest 2643 pass + 1 env.**

| Commit | What |
|---|---|
| `ee44a3c` | Pruned **77** unused `@/lib/db` barrel re-exports (175 retained; consumers use direct module paths). tsc as final guard. |
| `5380bbf` | Removed dead `toneFor` (def + 2 re-exports). |
| `752488d` | Removed dead exports: `RecommendationActor`/`buildManifest`/`LiveRepoSeed` re-exports; demoted `SECURITY_DIM` + `auth.ts GitHubError` to non-exported locals. |
| `ba2cd54` | Removed write-only dead fields `MatrixRow.base` + `GeneratedSkill.fileName` (+ their test assertions). |

Nothing skipped — every targeted item proved dead. Out of scope (runtime branches): `removeNewestHit`, `DimensionSignals.notes`.

---

## Wave 17 — LLM provider epilogue + short-date formatter (Theme J / last Highs)

**2 commits · llm-provider #1 (H) + quotas #1 (H) closed · gate: tsc 0 · vitest 2646 pass + 1 env (+3).**

| Commit | What |
|---|---|
| `32e347b` | `provider.ts`: `finalizeAssessment(text,usage,opts,label)` + `parseAssessment(text)`; `config.ts`: `llmTemperature()` (mirrors `llmTimeoutMs`). gemini/openai adopt finalize fully; claude-cli + bedrock use `parseAssessment`; all 3 real providers use `llmTemperature()`; `testBedrockConnection` reuses `withLlmTimeout`. Error msgs byte-identical via `label`. **Bedrock keeps its meter-always `onUsage` inline** (its test pins empty-path metering). Stale header comment + resolved BUG comment cleaned. |
| `7dce88d` | `format.ts`: `shortDate`/`shortDateSafe`; `formatResetAt`/`QuotaStaleNotice`/TrendChart route through them (byte-identical, invalid→`""`). Left `chartHover.shortDateTime` + `ui.ts` relative-time (different options). |

**All 35 High findings now addressed: 34 closed, 1 deferred (design-system #2 Stat — needs a `Stat` label-style prop).**

---

## Wave 18 — Org-dashboard adoptions (Theme H, Medium)

**3 commits · org-overview + people/delivery Mediums closed · gate: tsc 0 · vitest 2646 pass + 1 env.**

`331bb37` ScopeFilterBar: `scope.ts` gains a `barProps` bundle; teams/delivery/contributors use `<ScopeFilterBar {...barProps}>`, passports drops its inline bar reimpl. `0559b0d` `DIMENSION_SHORT` cast+fallback → new `dimShort` helper (OrgLeverageMoves ×2, SegmentComparisonView). `9789f31` overview dimension-average rows → shared `MeterRow`. **Left (visual divergence):** overview SegmentSelector (unconditional for the "+ Create segment" CTA), posture rows (`text-base` vs MeterRow `text-sm`), all `postureLabel` sites (helper title-cases unknown ids), all 3 progress bars (different motion/structure).

## Wave 19 — Fleet rollup + alerts helpers (Medium)

**4 commits · fleet-rollups + fleet-alerts Mediums closed · gate: tsc 0 · vitest 2646 pass + 1 env.**

`69c7e88` new `GroupedMean` accumulator (3 sites) + `dateRange()` window helper (3 sites) + `mean`→`avg` alias fix. `294831c` `loadRepoDimScores` shared by practices/gap. `000a7e9` `mrkdwnSection`/`linkContext` Block-Kit factories (4 builders, JSON byte-identical) + `signed()` formatter. `cc3681d` `org-alerts` `updateOrgById` tail. **Signed-formatter drift unified on `>=0` — no output change** (delta sites only run for nonzero moves).

---

## Pattern catalogue (durable — grep these shapes proactively in future audits)

1. **Triplicated fail-closed auth gate.** A security check (cron secret, CSRF, role) copy-pasted across sibling routes drifts — one ascent cron route had historically fail-opened. Fix: extract `requireX(request): Response | null` (reject-or-null) and adopt at every site so the policy lives once.
2. **Locally-reimplemented canonical guard.** A helper already exists in `lib/auth`/`lib/site` but a route hand-rolls its own copy (often a stale fork). Fix: delete the copy, import the canonical; preserve the route's exact observable response.
3. **Inline entity-resolver copies vs a canonical resolver.** ~35 inline `findUnique({where:{slug}})→id` lookups duplicated a canonical `getOrgId`. Before adopting, verify the canonical's exact semantics (normalization, missing-value contract, db-guard) match each site, and lean on the upstream invariant (slugs stored/queried lowercased) so normalization is a no-op.
4. **Test mocks that don't mirror production normalization.** A fakePrisma resolved slugs case-sensitively while prod stores lowercase + normalizes on lookup; adopting the normalizing resolver exposed the mock's wrong assumption. Fix the mock to mirror prod, not the code.
5. **"Adopt the canonical resolver" has boundary cases.** When mass-adopting a resolver, leave the sites it can't serve: upsert/create-if-missing (resolver returns null on missing), transaction-scoped client reads, and reads that need columns beyond the resolved id. Adopt only the pure id-read sites; deduping the rest would change behavior.
6. **Multi-doc theme extraction with per-doc overrides.** Don't flatten when hoisting shared style/theme constants across N documents — diff all N first, hoist only identical values, keep per-doc overrides where they differ. Flattening silently changes output (no snapshot test will catch a PDF).
7. **Shared crypto codec, per-caller parameters.** Deduping HMAC sign/verify across share flows: parameterize the legitimately-different bits (secret env var, TTL) and keep each caller building its own payload, so JSON key order → token bytes stay identical and already-issued tokens still verify.
8. **The "shared" helper can be the buggy fork.** Four SSE parsers existed; the one in the shared lib silently corrupted multi-line `data:` while a component kept a correct private copy. When consolidating, adopt the *correct* implementation as the single source (not whichever is labeled "shared"), and add a test for the bug it fixes.
9. **Consolidate the transport, keep per-call error taxonomies.** Four GitHub JSON fetchers shared a body but had genuinely divergent status→error mappings (one parsed `retry-after` / had a 401 case another collapsed). Extract the transport (headers+timeout+fetch) into one helper, but let callers keep their own typed error mapping — don't merge error classes that have provably diverged.
10. **"Single source of truth" comments are drift detectors.** Three Highs were values a comment explicitly claimed were single-sourced but weren't (`overallScoreFor`, AI-vocab, GatePolicy). Grep for "single source"/"keep in sync"/"must match" comments — they mark exactly the spots that have silently forked. Unify toward the *correct/complete* copy and flag the resulting output change.
11. **Load-bearing guard order.** When folding a route preamble (config 503 → session 401 → tenant 403 → install 403), the ORDER and per-check messages are observable — folding an earlier check into a shared helper changes which failure a request hits first (a signed-out request would get the tenant message instead of 401). Keep order-sensitive checks inline; only extract the tail that's truly common + order-independent (e.g. install-gate + token-mint + error mapping).
12. **Wholesale route-test mocks block helper adoption.** A route whose test does `vi.mock("@/lib/authz")` wholesale breaks if you move its guard into a new module the test doesn't mock. Leave such a handler inline unless you deliberately update the mock — same root cause as the "new `@/lib/db` export missing from a route-test mock" regression class.
13. **Drift = a missing validation, not just duplicate code.** A duplicated block had drifted by OMISSION (targetDate validation present on goals, absent on initiatives → bad dates silently coerced to null). De-duplicating a validation often means *adding* the missing copy — a deliberate behavior change worth flagging + testing, not a pure no-op refactor.
14. **Junctioned node_modules can fail HEAD's tests environmentally.** A worktree junctioning the main checkout's `node_modules` inherits its (possibly WIP-installed) deps. A test asserting an optional dep is ABSENT (`@aws-sdk/dsql-signer`) fails when the junction physically contains it, even though HEAD's `package.json` doesn't declare it. Diagnose, don't fix: `git log c8e04c3..HEAD -- <file> package.json` (untouched) + `grep dsql-signer package.json` (absent) ⇒ environmental, not a regression.
15. **A "re-implemented canonical component" finding can overestimate consolidation safety.** The scan said 5 inline `Stat` copies were "all expressible via className", but `className` governs only the wrapper — the canonical hardcodes a label style and the copies diverge in rendered classes, so adoption would change visuals. Verify the canonical's actual API/markup before adopting; if it can't reproduce a copy without an API extension, that's a (deferred) enhancement, not a pure refactor.
16. **Barrel prune is tsc-guarded but regex-fragile.** Pruning unused re-exports from a 252-symbol barrel: a naive "spanning" usage regex over-counted dead symbols (matched across preceding imports) and flagged ~40 live ones; tsc caught it. Use a non-spanning `import\s*\{[^{}]*\bX\b[^{}]*\}\s*from "@/lib/db"` check and let tsc be the final arbiter — removing fewer is safe, removing a live one errors loudly.
