# Doc drift audit (2026-07-28)

> **Remediation status (same day):** passes 1–7 below are complete. All nine
> OUTDATED docs were rewritten or corrected, the two undocumented groups shrank to
> one, and every false "Known gap" identified here was verified and removed. The
> per-doc findings are kept **as written at audit time**. They are the record of
> what was wrong, not a current description. For current state see
> [`features/README.md`](features/README.md). Remaining work is listed at the bottom.

Six Sonnet agents audited every doc in `docs/` against source, using
`context-map.json` to locate each feature's implementation. This is the evidence
base for the [`docs/features/`](features/README.md) restructure and for the
Documentation Sync rule in [`AGENTS.md`](../AGENTS.md).

**Method:** each agent read its assigned docs in full, located the owning context's
`filePaths`, read/grepped that source, and classified the doc CURRENT / STALE /
OUTDATED / ASPIRATIONAL with file:line evidence on both sides. Read-only; no agent
edited anything.

## Scoreboard

| Verdict | Count | Meaning |
| --- | --- | --- |
| CURRENT | 8 | Accurate against source |
| STALE | 7 | Mostly right; specific outdated claims or missing recent additions |
| OUTDATED | 9 | Materially wrong: describes removed, renamed, or superseded behavior |

Two context-map groups (**Org Knowledge & Skills**, **Marketing Site & Design
System**) had no doc at all. Roughly a dozen further shipped surfaces are
undocumented; each area README lists its own.

## The pattern worth naming

The most damaging drift was **not** missing documentation. It was
confidently-asserted "Known gaps" that the code had since closed:

- `practices.md`: *"One-at-a-time — no bulk 'apply to all gap repos'"*, but
  `POST /api/practices/apply-batch` ships exactly that, with UI.
- `org-planning/plan.md`: *"Simulator is single-dimension … no compound
  scenarios"*, but `orgsim.ts` models scenarios as multi-leg and adds ranking plus
  saved-scenario compare.
- `github/auth.md`: *"no invite/permission flow is wired"*, but the full invite/accept
  flow exists.
- `org-dashboard/org-intelligence.md`: *"No org invites / multi-user roles
  enforced"*, but both are wired.

A reader trusts a stated limitation more than silence. A stale "Known gap" actively
misinforms in a way an absent doc does not. Hence the AGENTS.md rule: **when you
close a gap, delete the sentence that described it.**

## Per-doc findings

### Repository Scanning & Scoring

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `scanning/scan.md` | CURRENT | Pipeline, D1–D9 table, guardband/blend constants, cache tiers all match `scan.ts`/`engine.ts`/`model.ts`. Omits `stack-fit.ts`, `tech-extract.ts`, `ai-tools.ts`, `pr-thresholds.ts`, `maturity/noise.ts`, `scoring/impact.ts`. |
| `scanning/maturity-model.md` | CURRENT | Verified line-by-line: 9 dimensions, all weights (0.15/0.15/0.14/0.12/0.09/0.07/0.07/0.12/0.09), `SCORE_BLEND=0.6`, `LLM_GUARDBAND=25`, `POSTURE_THRESHOLD=50` all match `model.ts`. Unusually well maintained: the code cites the doc back. |
| `scanning/calibration.md` | CURRENT | D9 calibration claims verified against `calibration.test.ts`. **Fixed in this pass:** said "12-repo set", `bench/repos.json` holds 20. |
| `scanning/gate.md` | CURRENT | D9-verbatim, guardband exclusion, every API param, 503-fail-closed, sticky-comment logic all verified against `gate.ts`/`pr-gate.ts`/`checks.ts`. |
| `scanning/llm-providers.md` | **OUTDATED** | Documents 4 providers; `PROVIDER_CHOICES` ships `openai` + `openrouter` too. Missing entirely: per-org BYOM (`getProviderForOrg()`, fails closed on decrypt failure), benchmark/scorecard machinery, Tracklight mirroring. `resolveProviderChoice()` now throws on unknown values rather than defaulting to `auto`. |
| `scanning/llm-model-matrix.md` | CURRENT | Self-flags its own key finding as superseded pending a re-bake (honest, not stale). |
| `scanning/async-scan-aws.md` | CURRENT (concept) | Explicitly "not implemented" with a stated adoption trigger (p90 > ~250s, or survive-tab-close). Live contingency doc. |

### Identity & GitHub Connectivity

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `github/auth.md` | **OUTDATED** | Documents the dormant custom OAuth as *the* auth system; zero mention of Supabase, which is the active wall (`access.ts:2`, `proxy.ts`). Omits `/api/auth/session` and `/api/auth/revoke-sessions`. `session/route.ts` documents its own past drift from this. False "no invite flow" gap. |
| `github/github-app.md` | STALE | Webhook table omits suspend/resume (distinct from delete), `WebhookDelivery` dedup/replay guard, `check_run` re-run trigger, and `after()`-deferred execution. Rest verified. |
| `github/setup.md` | STALE | §4 configures the inert OAuth path, so an operator following it gets no working sign-in. Omits embedded-PGlite local DB and the openai/openrouter/claude-cli provider setup. **Fixed in this pass:** nothing; the "no push-triggered re-scan" limitation is false (`runPushRescan()` exists) but sits in prose needing a rewrite. |

### Onboarding, Shell & AI Standard

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `onboarding/wizard.md` | STALE | Flow still works as described; key-files table omits `scanGate.ts` + `OnboardingGateStep.tsx`, `personalWatch.ts` + `OnboardingGatePersonal.tsx`, `OnboardingInvitePanel.tsx`, `retryRepo.ts`, `scanMode.ts`. |
| `onboarding/ai-manifest-spec.md` | CURRENT | `schemaVersion 0.1.0` matches `MANIFEST_SCHEMA_VERSION`; every manifest field present 1:1; doctor checks 1–7 and the 180s timeout match `doctor.ts`. |

### Org Scanning & Fleet Rollups

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `fleet/alerts.md` | **OUTDATED** | Detection/dispatch accurate, but misses the weekly fleet digest entirely: `/api/cron/digest` (229 lines) using `buildFleetDigestMessage`/`digestHasSignal`/`creditsAlertThreshold`, all exported from `alerts.ts`, the file the doc documents. |
| `fleet/cron-and-retention.md` | **OUTDATED** | Rescan was rewritten: `advanceSchedule()` no longer exists (now `claimRescan` lease + `advanceToFullCadence` + `advanceScheduleAfterFailure`). Adds credit reserve/refund, BYOM skip, bounded concurrency with wall-clock deadline, per-org token pre-resolution, `recordScanOutcome`, and 5 new return fields. Purge half still matches. |
| `fleet/enterprise.md` | STALE | Claims to document the system "as shipped"; build sequence stops at E1–E5, data-model table lists 6 of ~40 models. **Fixed in this pass:** said "8 dims" → 9. |

### Org Dashboard & Analytics

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `org-dashboard/practices.md` | **OUTDATED** | Asserts no bulk apply; `apply-batch` ships (`MAX_BATCH=25`, `mapPool`, per-repo error isolation). Missing: `artifactFingerprint` content-drift protection, shared `applyPracticeToRepo()`, `recordPracticePr()` post-merge lifecycle. |
| `org-dashboard/org-intelligence.md` | **OUTDATED** | Lists 10 nav tabs; `OrgNav.tsx` ships 21. Documents Segments as standalone; it's now `?tab=segments` and the old route redirects. Claims `src/lib/db/org.ts` holds all org queries; it's a 114-line re-export barrel. |
| `org-dashboard/roadmap.md` | STALE | Self-labeled forward-looking with ✅ markers (correct genre). Build sequence stops at F6; Passport/gate-policy/playbooks/org-decision all shipped after. |

### Org Planning & Execution

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `org-planning/plan.md` | **OUTDATED** | Asserts "no compound scenarios"; `orgsim.ts` models multi-leg scenarios and adds `rankFleetInvestments` + `Simulator.RankPanel.tsx` + saved-scenario compare. |

### Reporting, Billing, Data

| Doc | Verdict | Key evidence |
| --- | --- | --- |
| `reporting/report.md` | CURRENT | Route table, render order, charts, `diffScans`, `parseScanReport` all verified. |
| `billing/billing.md` | **OUTDATED** | Says "there is no subscription". Ships: 4-tier `PLAN_FEATURES` with seats/retention/feature gates, monthly-allowance-then-credit hybrid charge, `POLAR_PLAN_PRODUCTS`, and `clawbackOrderRefund` with plan downgrade on full refund. |
| `billing/usage.md` | STALE | Omits `inputTokens`/`outputTokens`/`estimatedCostUsd`/`costBasis`/`byRepo`. Says daily series buckets in JS, but that's now the fallback; primary is SQL `date_trunc`. Stale Stripe reference (billing is Polar, and wired). |
| `billing/badge.md` | STALE | Omits `recordBadgeImpression()`/`recordQuotaEvent()`, per-org `getOrgGatePolicy()` resolution, `BADGE_NEG_CACHE_MAX`. |
| `data/data-model.md` | **OUTDATED** | Documents 14 models and calls it "the 14-model schema"; schema has 40. `Organization` entry omits `kind`, `scanCredits`, alert tuning, `gatePolicy`, branding. DSQL principles and `persistScanReport()` still accurate. |

### Top-level

| Doc | Verdict | Disposition |
| --- | --- | --- |
| `ARCHITECTURE.md` | STALE | Kept top-level. Principles/request-flow/DSQL-rationale accurate. ERD is hackathon-era and duplicates `data/data-model.md`; provider list shows 3 of 6. |
| `README.md` | STALE | Kept. "9 dimensions" correct; PDF export no longer aspirational. **Enterprise SSO claim is aspirational**: no SAML/SSO exists. |
| `SETUP.md` | **OUTDATED** | Kept top-level, but see `github/setup.md` for the same auth problem. Most urgently wrong doc for a new operator. |
| `PRD.md` | LIVING | Kept. §7 monetization describes per-scan pricing; tiered plans shipped instead. |
| `VISION-TRANSITION.md` | LIVING | Kept. Most recently maintained; good self-maintaining pattern (dated ✅ delivery markers). |
| `VALUE-CASE.md` | LIVING | Kept until D28–D32 close. |
| `REFERENCE-SCAN-AUDIT.md` | HISTORICAL | Kept top-level for now as VALUE-CASE's companion; archive together once D28–D32 resolve. |
| `PRODUCTION_READINESS.md` | **OUTDATED** | → `archive/2026-audits/`. Most P0s resolved: LICENSE exists, vitest declared+locked, 32 migrations committed, the `/api/scan` IDOR fixed in `resolveScanAuth`, `requireOrgAccess` wired across org routes, PDF export built. Reading it as live guidance actively misleads. |
| `BACKLOG.md`, `PLAN.md`, `HACKATHON.md` | HISTORICAL | → `archive/2026-hackathon/`. BACKLOG's status column marks shipped work as not-started. |
| `EVAL-FINDINGS.md` | HISTORICAL | → `archive/2026-eval/`. Superseded in substance by REFERENCE-SCAN-AUDIT; kept as calibration history. |
| `concepts/2026-06-21-byom…`, `concepts/2026-06-22-passport…` | SUPERSEDED (built) | → `archive/2026-concepts/`. Kept for design-rationale archaeology; `passport.ts` cites the latter. |
| `contexts/scan-report-*.md` | RUN OUTPUT | → `archive/context-scans/`. |

## Remediation passes (completed 2026-07-28)

| # | Pass | Outcome |
| --- | --- | --- |
| 1 | `github/auth.md` + `SETUP.md` | Both rewritten around the two-stack reality (Supabase active, custom dormant). `SETUP.md` row E now creates a Supabase project; the dormant stack is row E′. Added the PGlite local-DB path and the other four LLM providers. |
| 2 | The false "Known gaps" | All four verified against source and removed, each replaced by what is *actually* true. `practices.md` also gained the batch-apply, drift-guard, and PR-tracking sections; a fifth false gap ("no adoption tracking") was found and corrected during the pass, as was `github/setup.md`'s "no push-triggered re-scan". |
| 3 | `data/data-model.md` | Rewritten: all 40 models, grouped into 9 feature areas via the context map. Corrected the persist path (`scans.ts` is now a barrel; logic lives in `scans-persist.ts`). |
| 4 | `billing/billing.md` | Rewritten: the four-tier `PLAN_FEATURES` table, the `decideScanCharge` hybrid (`unlimited`/`allowance`/`credit`/`denied`), credit packs vs plan products, webhook events, and `clawbackOrderRefund`'s cumulative-fraction math. `usage.md`'s stale Stripe note fixed. |
| 5 | Split `cron-and-retention.md` | → `fleet/rescan.md` (rewritten) + `data/retention.md` (preserved and extended with the safety floors, dry-run, and degraded-status contract). |
| 6 | Write `org-knowledge/` | `memory.md` and `skills.md` written from source: the group's first documentation. |
| 7 | `llm-providers.md`, `org-intelligence.md`, `alerts.md` | Providers doc rewritten (all six + BYOM + benchmark + Tracklight); nav table corrected to the real 21 tabs and 6 rail sections; digest section added. |

## What's still open

Doc work:

- **`design-system/`**: the last group with no doc.
- **`fleet/enterprise.md`** and **`org-dashboard/roadmap.md`**, historical accounts
  still framed as current. Both need a dated "as of" header rather than a rewrite.
- **`github/setup.md` §4** should shrink to a pointer instead of duplicating auth setup.
- **`onboarding/wizard.md`**, **`billing/usage.md`**, **`billing/badge.md`**,
  **`github/github-app.md`**, **`org-planning/plan.md`**, each STALE for a specific,
  listed reason in its area README.
- Undocumented surfaces across reporting, org-planning, org-dashboard, and onboarding,
  enumerated per area.
- The ERD in `ARCHITECTURE.md` duplicates `data/data-model.md` at an older schema
  version; it should become a pointer.

Product gaps surfaced by the doc work (not doc bugs):

- **A brand-new production sign-in lands on an empty dashboard**: org auto-discovery
  and watchlist seeding run only in the dormant callback. See `github/auth.md`.
- **Plan `seats` may be declarative**: the cap is defined in `PLAN_FEATURES` but its
  enforcement at the membership-write path is unverified.
- **Memory reflect may be API-only**, and **decay has no scheduled trigger**. See
  `org-knowledge/README.md`.
- `.env.example` has no OpenRouter block despite the provider reading its vars.
