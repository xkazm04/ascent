# Bug-UI Fix Wave 5 — Silent Failure / Success-Theater

> 4 atomic commits, 6 findings closed (6 high) + 1 found already-mitigated.
> Baseline preserved: `tsc` 0 → 0 errors · tests 480/480 → 482/482 (+2 llm honest-selection tests).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `32d0072` fix(api/health): stop leaking the raw DB error | app-shell #1 | High | `api/health/route.ts` |
| 2 | `9e862cc` fix(llm): trust explicit openai/claude-cli selection — no silent mock | llm-provider #1 | High | `llm/index.ts` (+test) |
| 3 | `108ecf7` fix(scoring): warn when every detector fails | maturity #1 | High | `scoring/engine.ts` |
| 4 | `7aa60f7` fix(ui): roll back optimistic updates + surface failures | playbooks #1, onboarding #1, connect #2 | 3×High | `PlaybookCard.tsx`, `OnboardingFlow.tsx`, `InstallationRepos.tsx` |

## What was fixed

1. **Health endpoint leaked the raw DB error (High).** `/api/health` spread the `dbHealthCheck` result into the public body, exposing the raw Prisma/Postgres error string to unauthenticated callers during an outage. Now reports only `status`/`db`/`reconnected`; the error is logged server-side.
2. **LLM silent mock degrade (High).** `LLM_PROVIDER=openai`/`claude-cli` pre-degraded to mock when an env sniff failed, setting `intendedProvider="mock"` downstream — which suppressed the `llmFailed` warning + fallback SSE event, so a misconfigured deploy served mock scores with no caveat. They now trust the explicit selection (like the already-fixed bedrock branch) and degrade through the *accounted* retry → failover → mock chain.
3. **Total-detector-failure read as L1 (High).** When every detector fails, `dimensions` is empty, the overall scores 0, and the repo levels at L1 — indistinguishable from a genuine manual repo. The engine now pushes a loud warning flagging the scan as INCOMPLETE.
4. **Optimistic UI success-theater (3×High).** `PlaybookCard.apply`/`unapply` fire-and-forgot the fetch (no `res.ok`, no rollback) → the card showed adoption the DB never recorded; both now roll back on failure. `OnboardingFlow` was stranded on "scanning" forever when an SSE `error` arrived with a clean stream end (the outcome resolved `ok:true`); `onError` now advances the phase to "select". `InstallationRepos` bulk watch showed a positive "Now watching 0 repos" when every row failed; an all-failed batch now reads as an error.

## Already-mitigated (already-existed catch, Phase 4.1d)

- **Audit-write failures dropped (security #1, High).** The report flagged `recordAudit` as silently swallowing failures, but it **already logs loudly with full context** (action/org/actor/meta) on a failed write — hardened in a prior wave. The remaining "callers ignore the boolean return" is a minor dead-contract; the silent-failure aspect is closed. **No change needed.**
- **Connect bulk all-failed** was *partly* already handled (per-row `failed[]` rollback + "· N failed" suffix); this wave only added the all-failed → error refinement.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 480/480 | 482/482 |
| New tests | — | +2 (llm honest selection) |

Note: the 3 UI fixes (playbooks/onboarding/connect) have no component-test harness in this repo; verified by `tsc` + manual diff review of the optimistic-rollback logic.

## Patterns established (catalogue items 14–15)

14. **A 2xx is not success — check the body's per-item outcome.** A bulk endpoint that returns 200 with a `failed[]` list, or an SSE that emits an `error` event before a clean close, has *failed* for those items. The client must read the payload, not just the status/stream-end, before showing success.
15. **Degrade visibly, account honestly.** When a service falls back (real model → mock, primary → fallback), the fallback must be recorded as a fallback (warning + event), never relabeled as the intended path — otherwise a permanent silent degrade looks identical to success.

## What remains

Remaining waves per INDEX: **W6 Scoring & gate correctness (the 7th critical)** · W7 dates · W8 file-gen/XSS · W9 GitHub resilience · W10 a11y · W11 UI polish.
