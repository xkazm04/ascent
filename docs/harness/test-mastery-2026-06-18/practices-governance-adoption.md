> Total: 5 findings (2 critical, 2 high, 1 medium)
# Test Mastery — Practices, Governance & Adoption

This context turns fleet analytics into **writes against customer repos**: `/api/practices/apply` and `/api/practices/apply-batch` open draft PRs that seed starter files via `openDraftPr` (`src/lib/github/write.ts`), and `buildGovernanceOverview` / `buildAdoptionOverview` derive the dashboards and Copy-for-LLM briefs leaders act on. The test suite today covers only the **pure markdown renderers** (`governanceMarkdown`, `adoptionMarkdown`) and the **pure artifact builder** (`buildArtifact`) — every async assembly function, the PR-write safety guard, and all three route handlers are untested. The risk lives one layer above where the tests stop.

---

## 1. Test the "never overwrite a real file" guard in openDraftPr — it is the only thing standing between a fleet rollout and mass data-loss

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/github/write.ts:81-88 (`existingFileSha` BASE check) and :100-105 (the create-or-update PUT it protects)
- **Scenario**: A refactor reorders the flow so the create-or-update PUT runs before the base-branch existence check, or the `existingFileSha` 404→null swallow (write.ts:60) is widened to also swallow another status, or the check is accidentally made against `branch` instead of `base`. `openDraftPr` then PUTs a TODO scaffold over a repo's real `SECURITY.md` / `.github/workflows/ci.yml` / `AGENTS.md`. The PR looks normal; merging it **deletes the customer's real content**. Via `/api/practices/apply-batch` one click fans this across up to 25 repos.
- **Root cause**: `write.ts` has no test file at all (`grep openDraftPr` finds only callers, no spec). The module's own header and the 8-line SAFETY comment at :74-80 document exactly this hazard, yet nothing asserts the behavior — it's protected by a comment, not a test.
- **Impact**: Silent destruction of governance/security files across a whole fleet from a single "Roll out to the fleet" action — the worst-case data-integrity event this product can produce, and it ships unguarded against regression.
- **Fix sketch**: Add `src/lib/github/write.test.ts` with a stubbed `githubAppFetch` (mock by path/method). Assert the invariants: (a) when the file **already exists on `base`**, `openDraftPr` throws `AppApiError` with `status === 409` and **never issues the contents PUT** (assert the PUT mock was not called); (b) when the file exists **only on the generated branch** (404 on base, sha on branch), it proceeds and includes that `sha` in the PUT body (idempotent re-seed); (c) a 422 on branch-create is tolerated (reuse) but a 422 on PR-create returns the existing open PR with `reused: true`. The load-bearing assertion is (a): base-file-present ⇒ zero writes.

## 2. Test the apply / apply-batch tenant gate and batch invariants for FAILURE, not just the happy path

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/practices/apply/route.ts:42-43 (`requireOrgAccess`) and src/app/api/practices/apply-batch/route.ts:59-67 (same-org check + gate), :77 (MAX_BATCH)
- **Scenario**: The `requireOrgAccess(parsed.owner)` line is moved below the token mint, or `await`/`return` is dropped (a `denied` that's truthy but not returned), or the `owners.size > 1` same-org check (apply-batch:60) is loosened. A signed-in user from org A then opens draft PRs in org B's private repos using B's installation token — a cross-tenant **write** IDOR. Separately, if `parsed.slice(0, MAX_BATCH)` (apply-batch:77) regresses, one request opens hundreds of PRs.
- **Root cause**: Neither route has a `route.test.ts` (`glob src/app/api/practices/**/route.test.ts` → none). The header comments call these paths "sensitive" and "a cross-tenant write IDOR" risk, but no test exercises the 401/403/400 branches. Sibling org routes (`/api/org/import/route.test.ts`, `/api/org/scan/route.test.ts`) prove this style of route test is already established in the repo.
- **Impact**: A privilege-escalation write to arbitrary customer repos, or an unbounded PR storm — both silently shippable.
- **Fix sketch**: Add `apply/route.test.ts` + `apply-batch/route.test.ts` mocking `requireOrgAccess`, `getInstallationIdForOwner`, `openDraftPr`, `recordAudit`. Assert: a denying `requireOrgAccess` (returns a 403 Response) ⇒ handler returns that 403 and `openDraftPr`/`getInstallationToken` are **never called**; missing `installId` ⇒ 403; `repos` spanning two owners ⇒ 400 with no writes; a 30-repo batch ⇒ `attempted === 25` and `skipped === 5`; one repo throwing inside the pool ⇒ its result is `{ok:false}` while the others still succeed (one bad repo never aborts the batch). Invariant: no write side effect occurs on any auth/validation failure.

## 3. Test buildGovernanceOverview's green-path math and per-reason dedup — the dashboard's correctness lives here, not in governanceMarkdown

- **Severity**: High
- **Category**: success-theater
- **File**: src/lib/org/governance.ts:99-176 (`buildGovernanceOverview`), esp. :124-130 (per-repo reason dedup), :134-151 (gap/closest-to-green math)
- **Scenario**: The `byReason` dedup `Set` (governance.ts:124) is dropped, so a repo failing 3 dimensions inflates the "dimension" count 3×; or `floorFor` (:114) stops taking the stricter of global vs per-dim floor; or the `closestToGreen` sort key (:159) inverts, so the "cheapest path to green" worklist surfaces the *hardest* repos first. Every such regression produces a plausible-looking dashboard and a confidently-wrong Copy-for-LLM brief — leaders prioritize the wrong repos.
- **Root cause**: `governance.test.ts` only tests `governanceMarkdown` against a **hand-authored `GovernanceOverview` fixture** and `evaluateGateLite` in isolation. The function that *produces* the overview from a rollup — all the dedup, gap arithmetic, sorting, and the `slice(0,12)`/`slice(0,8)` caps — is never executed by a test. The fixture is success-theater: it asserts the renderer faithfully prints numbers a human typed, not that the engine computes them.
- **Impact**: Misallocated engineering investment across the fleet and an authoritative-looking but wrong executive narrative — the core value of the governance view, untested.
- **Fix sketch**: Mock `getOrgRollup` + `getOrgGatePolicy` and drive `buildGovernanceOverview` with a 3–4 repo rollup. Assert: a repo failing two dimensions increments `byReason.dimension` by exactly 1 (dedup); `closestToGreen[0]` is the single-condition / smallest-`gap` repo and `gap` equals the summed points-to-floor; `floorFor` honors the stricter of `minDimension` and `minDimensionFor`; repos without `latest` are excluded; empty/zero-scanned rollup ⇒ `null`.

## 4. Test buildAdoptionOverview's distribution bucketing and null-guard against real contributor inputs

- **Severity**: High
- **Category**: success-theater
- **File**: src/lib/org/adoption.ts:30-57 (`buildAdoptionOverview`), esp. :38-43 (high/some/none bucketing) and :36 (empty-guard)
- **Scenario**: The bucket boundaries (`aiShare >= 50` heavy, `> 0` partial, else none) drift — e.g. a `>= 50` becomes `> 50`, silently miscounting champions at exactly 50%, or a contributor with `aiShare === 0` falls into "some". The distribution shown on the adoption page and in the enablement brief is then wrong, but `adoptionMarkdown`'s test still passes because it feeds a pre-bucketed fixture. The `insights.totalContributors === 0 ⇒ null` guard (:36) is also unverified — a regression there would render a divide-by-zero / empty dashboard.
- **Root cause**: `adoption.test.ts` only covers `adoptionMarkdown` with a fixed `AdoptionOverview`. The async assembly — bucketing, `champions.slice(0,6)`, the `delivery` null-on-no-PR-data branch, the `knowledgeLeader` optional chain — has no test. Boundary-sensitive counting logic with zero boundary tests is exactly where an LLM-generatable batch closes a real gap fast.
- **Impact**: Wrong AI-adoption numbers drive enablement spend at the people/team level; a broken empty-guard breaks the page for a fresh org.
- **Fix sketch**: Mock `getContributorInsights` / `getOrgPrSignals` / `getOrgTeamRollup`. Table-test bucketing with contributors at `aiShare` 0, 1, 49, 50, 80 ⇒ assert exact `{high, some, none}`. Assert `totalContributors === 0 ⇒ null`; `pr === null ⇒ delivery === null`; `champions.length <= 6`. Invariant: every contributor lands in exactly one bucket and the three buckets sum to `contributors.length`.

## 5. Lock the language→commands map and the empty/unknown-language fallback in buildArtifact

- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/practice-artifact.ts:49-63 (`commandsFor`), :72-99 (`ciWorkflow` setup branches)
- **Scenario**: `commandsFor` is the single source of truth reused by the onboarding-skill generator and `standard/manifest` (`grep commandsFor` → 3 modules). If a case is dropped or a command string typos (`npm ci` → `npm install`, `go test ./...` → `go test`), every generated CI workflow and AGENTS.md across all three consumers ships a broken command — into customer repos as a PR. The unknown/empty-language path must degrade to the `<install deps>` placeholders + `# TODO` CI setup, not emit a confidently wrong node default.
- **Root cause**: `practice-artifact.test.ts` checks TypeScript and Go and asserts "every practice yields an artifact with body length > 40", but never pins Python/Rust commands, the `ci: "generic"` placeholder branch, or that an empty/`null` language doesn't silently inherit node's `setup-node` step. The "> 40 chars" assertion is coverage-chasing — it would pass on garbage output.
- **Impact**: Broken CI/build commands seeded fleet-wide via PRs, eroding trust in the "systematic apply" feature and forcing manual cleanup in every target repo.
- **Fix sketch**: Table-test `commandsFor` for python/rust/empty/unknown asserting exact `{install,test,lint,build,ci}` tuples; assert `commandsFor(null).ci === "generic"`. For `buildArtifact("ci-gates", {primaryLanguage: null})` assert the workflow contains the `# TODO: add the language setup step` line and **not** `setup-node`. Invariant: an unknown language never produces a node-specific (or any concrete) toolchain step.
