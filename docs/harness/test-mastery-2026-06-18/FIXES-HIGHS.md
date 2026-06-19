# Test Mastery — ascent — High-tier fixes (Waves H1–H8)

> The 76 High findings, worked after all 60 criticals. **All 76 closed.**
> Suite: **1155 → 1727 tests (+572).** tsc 0 throughout; `next build` compiles. 0 regressions.
> 65 closed via dedicated High-wave tests; **11 were already covered by earlier critical-wave tests** (confirmed by dedup checks, not re-done).

## Per-wave ledger

| Wave | Theme | Fresh Highs | Already-covered | Suite after |
|---|---|---:|---:|---:|
| H1 | Auth/IDOR routes & gates | 7 | 1 (backlog=recommendations route) | 1236 |
| H2 | Webhooks, sessions, secrets | 10 | — | 1318 |
| H3 | Standard/app-shell/score-math/runtime | 10 | — | 1407 |
| H4 | Money/destructive/data | 11 | — | 1481 |
| H5 | Score-math/parse/runtime | 8 | — | 1556 |
| H6 | Frontend/parse/aggregates | 8 | — | 1641 |
| H7 | The Z-tail + success-theater cleanup | 7 | 1 (autoscanReadiness=health route) | 1718 |
| H8 | Mop-up + dedup confirmation | 4 | 3 (exec-briefing-disjoint=W4, ci-gate-overwrite=W3, data-retention=W3) | 1727 |
| **Total** | | **65** | **11** (5 more incidentally covered by W4/W7/H2 criticals tests) | **1727** |

## What the High tier added (highlights)

- **Auth/IDOR route layer:** credit-grant endpoint guards, goals/initiatives + segment-routes + recommendations PATCH cross-tenant gates, exec-briefing PDF gate, `resolveScanAuth` authorize-before-mint, `buildSecurityOverview` honest degradation, `requireOrgRole` TOFU claim, webhook `runPrGate`/`runPushRescan`, the auth **production-bypass kill-switch** + `decodeSession` forgery rejection, `live-share` casing contract, badge logo-XSS, `validName` path-traversal, the **ci-gate 200/422 CI contract**, cron-digest per-tenant routing.
- **Money/metering:** `getCreditReconciliation` refund-vs-grant, the transactional quota consume/deny/refund + DSQL isolation, org-import credit-cap slice + per-repo refund, org/scan never-scan-for-free, watch-schedule cost disclosure (no `?? 0` trap), per-provider usage attribution.
- **Score/verdict math:** `applyGovernanceSignals`/`applyPrSignals`/`classifyArchetype`, `validateAssessment` hardening, `vScale`/`xScale` NaN-guard, the chart-band-ramp-equals-rubric lock, `buildGovernanceOverview`/`buildAdoptionOverview`, the simulator DB-orchestration layer, movers-diff sign + window baseline math.
- **Parse/trust boundaries:** report-shell `parseSSE`, the persisted-JSON parse helpers (total functions), `cleanSteps`/`parseSteps` bounds, SKILL.md frontmatter-injection + code-fence escaping, history CSV escaping, `playbookStarterFile` exact artifact, the manifest doctor executed against fixtures.
- **Runtime/infra:** `getPrisma` cold-start + `dbHealthCheck` self-heal (no secret leak), `dispatchAlert` 2xx/non-2xx/throw, `fetchBranchGovernance`/`resolveHead` status mapping, `getOrgBacklog`/`getContributorInsights` (bus-factor + champion ranking), the init-sql inline-`@unique` drift guard, supply-chain quiet-degradation honesty, the scan-persist head-pointer recency guard.
- **Frontend extractions (behavior-preserving, source touched):** the war-room SSE fold (H3), the scanOrg filter / bulk-watch accounting + filter predicate / byProminence comparator (H4), the import-cost disclosure (H6). All re-imported into their components; `next build` compiles.
- **Success-theater cleanup:** the init-sql index guard now checks inline `@unique`; the scan-persist "exercised by e2e" claim replaced with a real head-pointer test; the goals e2e dead-heading assertion replaced with a real rendered element.

## A 9th documented-and-pinned latent bug (from H6)

**`/api/history` CSV formula-injection** — `csvField` only quotes on `[",\n]`, so a cell starting with `=`/`+`/`-`/`@` is emitted raw (a live-formula injection risk in Excel/Sheets). Pinned as current behavior so a future neutralizer is deliberate. (Joins the 8 documented in CUMULATIVE-STATUS.md.)

## Method (same discipline as the criticals)

Per-fix subagents wrote + self-verified each test (no git, no source edits except behavior-preserving extractions); the orchestrator ran the full suite + tsc (+ `next build` when source changed) centrally and committed each atomically with a `Refs:` line. Every subagent first dedup-checked against existing tests — which is why 11 Highs were confirmed already-covered rather than duplicated, and why several extraction subagents correctly tested an existing module instead of re-extracting and breaking its consumers.

## Status

**All 60 criticals + all 76 Highs closed.** Remaining: 40 Mediums + 16 Lows (untouched), and the per-area/changed-code CI coverage gate (the durable backstop), plus the 9 documented latent bugs for a follow-up `fix(...)` pass.
