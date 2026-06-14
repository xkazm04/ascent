# Feature Scout Scan — Ascent, 2026-06-14 (round 2)

> Capability-gap discovery across the **newer / less-scouted** product surface: what's missing,
> half-built, or built-but-unexposed. Run on the freshly-regenerated context map (38 contexts / 9 groups).
> 22 parallel Feature Scout subagent runs (one per context), batched in waves of 8 + 8 + 6. ~260 files read.
> Scanner: `feature_scout` (registry: src/lib/prompts/registry/agents/feature-scout.ts).
> Scope: the 22 contexts in 6 groups built/expanded since the 2026-06-08 scan — Org Planning & Execution,
> Billing/Credits & Metering, Org Dashboard & Analytics, Onboarding/Shell/AI Standard, Fleet Alerts & Members,
> CI Gate. Target: 4–6 findings/context. Every gap grep-confirmed genuinely absent before listing.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 22 contexts | 20 | 56 | 49 | 4 | **129** |
| Share | 16% | 43% | 38% | 3% | 100% |

Severity here = **priority/value**: Critical = core capability gap blocking the value prop · High = high-value extension users expect · Medium = nice-to-have · Low = polish.
Verified two ways: 22 `> Total:` headers sum to 129; 129 `- **Severity**:` bullets — both agree.

---

## Per-context breakdown

(Sorted by criticals desc, then total)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | AI-Native Standard & Onboarding Skill | Onboarding/Shell/AI | 1 | 3 | 2 | 0 | 6 | `ai-native-standard-onboarding-skill.md` |
| 2 | Backlog Management | Planning & Exec | 1 | 3 | 1 | 1 | 6 | `backlog-management.md` |
| 3 | Credits & Entitlements | Billing | 1 | 2 | 3 | 0 | 6 | `credits-entitlements.md` |
| 4 | Executive Briefing | Planning & Exec | 1 | 2 | 3 | 0 | 6 | `executive-briefing.md` |
| 5 | First-Run Onboarding Wizard | Onboarding/Shell/AI | 1 | 3 | 2 | 0 | 6 | `first-run-onboarding-wizard.md` |
| 6 | Fleet Alerts & Digests | Org Scanning | 1 | 3 | 2 | 0 | 6 | `fleet-alerts-digests.md` |
| 7 | Goals & Initiatives | Planning & Exec | 1 | 3 | 2 | 0 | 6 | `goals-initiatives.md` |
| 8 | Investment Simulator & Forecast | Planning & Exec | 1 | 3 | 1 | 1 | 6 | `investment-simulator-forecast.md` |
| 9 | Launch Fleet Map | Onboarding/Shell/AI | 1 | 2 | 3 | 0 | 6 | `launch-fleet-map.md` |
| 10 | Live War Room | Planning & Exec | 1 | 3 | 1 | 1 | 6 | `live-war-room.md` |
| 11 | Members & Access Control | Org Scanning | 1 | 3 | 2 | 0 | 6 | `members-access-control.md` |
| 12 | Org Overview & Standing | Org Dashboard | 1 | 2 | 3 | 0 | 6 | `org-overview-standing.md` |
| 13 | People & Delivery Analytics | Org Dashboard | 1 | 3 | 2 | 0 | 6 | `people-delivery-analytics.md` |
| 14 | Playbooks | Planning & Exec | 1 | 2 | 3 | 0 | 6 | `playbooks.md` |
| 15 | Practices, Governance & Adoption | Org Dashboard | 1 | 3 | 2 | 0 | 6 | `practices-governance-adoption.md` |
| 16 | Quotas & Rate Limiting | Billing | 1 | 2 | 3 | 0 | 6 | `quotas-rate-limiting.md` |
| 17 | Repositories & Segments | Org Dashboard | 1 | 2 | 3 | 0 | 6 | `repositories-segments.md` |
| 18 | Security Posture & Audit Log | Org Dashboard | 1 | 3 | 2 | 0 | 6 | `security-posture-audit-log.md` |
| 19 | CI Gate & Status Checks | Repo Scanning | 1 | 2 | 2 | 0 | 5 | `ci-gate-status-checks.md` |
| 20 | Connect & Repo Selection | Onboarding/Shell/AI | 1 | 2 | 2 | 0 | 5 | `connect-repo-selection.md` |
| 21 | Usage Metering & Public Badge | Billing | 0 | 3 | 3 | 0 | 6 | `usage-metering-public-badge.md` |
| 22 | App Shell, SEO & Error Pages | Onboarding/Shell/AI | 0 | 2 | 2 | 1 | 5 | `app-shell-seo-error-pages.md` |

---

## The 20 critical findings — one-line summaries (grouped by theme)

Finding IDs = context prefix + number (e.g. `BKLG-1`). Mediums/lows live in the per-context reports.

### Theme 1 · Close the action loop — insights that dead-end with no "do it" (the biggest pattern)

- **BKLG-1 — Act on a backlog item: open a draft PR from the row.** Backlog is read-only ROI metadata; `openDraftPr` (branch→file→PR, idempotent, audit-logged) is built but wired only to the Practice Library. `backlog-management.md`
- **SIM-1 — Commit a simulated scenario into a tracked Initiative/Goal.** `FleetProjection` is rendered and thrown away; `createInitiative` already accepts the exact `{dimId,targetScore,repos}` shape. `investment-simulator-forecast.md`
- **PLAY-1 — One-click playbook rollout via draft PRs.** Authored playbooks support only "Copy for LLM" markdown though the draft-PR rollout machinery exists for derived practices. `playbooks.md`
- **PRAC-1 — Fleet rollout: apply a practice to all gap repos at once.** `PracticeApply` is one-repo-per-call via a `<select>`; the gap list + idempotent `openDraftPr` already exist. `practices-governance-adoption.md`
- **STD-1 — Doctor conformance never flows back into Ascent (no adopt→verify→re-score loop).** Doctor computes a conformance %; nothing ingests it, so the core adopt→verify loop dead-ends at a local console log. `ai-native-standard-onboarding-skill.md`
- **MAP-1 — Fleet-map stars are dead ends — no click-through to the repo report.** Stars carry only a tooltip; `reportPermalink()` + `/report/[owner]/[repo]` already exist. `launch-fleet-map.md`

### Theme 2 · Expose dormant backends — shipped capability with no UI

- **MEM-1 — Member management has no UI; RBAC reachable only by raw API calls.** Full `GET/POST /api/org/members` + roles + gates + tests ship with zero management surface. `members-access-control.md`
- **ALRT-1 — No in-app UI to configure or test the alert webhook.** `GET/POST /api/org/alerts`, validation, per-tenant routing all exist; unreachable without manual SQL. `fleet-alerts-digests.md`
- **SEG-1 — Segment-scoped scan & cadence built into the backend but unreachable from any UI.** `/api/org/schedule` takes `segmentId`; `setWatchedSchedule` filters by `segmentScope`; no UI ever passes a segment. `repositories-segments.md`
- **CONN-1 — Bulk watch + bulk schedule on the filtered repo set.** `setWatchedSchedule` (whole set / segment in one write) exists; the connect UI fires one POST per repo (80-repo org = 80 calls). `connect-repo-selection.md`

### Theme 3 · Notifications — the right signal never reaches a human

- **GOAL-1 — Goal at-risk alerts never reach a leader.** `listGoals` computes `pace:"behind"`, `requiredPerWeek`, `etaDate`, but the digest/alerts layer has zero goal awareness despite all webhook plumbing. `goals-initiatives.md`
- **SEC-4 — No security alert on new critical vulnerabilities or gate failures.** Alert loop fires only on overall-score regressions; new CVEs / D9 gate failures surface only on page load. `security-posture-audit-log.md`
- **EXEC-1 — Scheduled/emailed briefing — the briefing never reaches an inbox.** Header promises a "scheduled PDF digest"; there is no email channel anywhere (Slack/webhook only). `executive-briefing.md`

### Theme 4 · Monetization & conversion funnel

- **CRED-1 — Self-serve credit purchase (Stripe Checkout): the missing revenue path.** Accounting/ledger/402 all shipped; the purchase flow is design-stage only — credits enter prod only via an owner-gated `grant`. The product currently generates $0. `credits-entitlements.md`
- **QUOTA-1 — The blocked-scan moment has no paid upgrade path — the funnel dead-ends.** No `/pricing`/`/upgrade`/Stripe anywhere; the highest-intent moment converts nobody. `quotas-rate-limiting.md`

### Theme 5 · Planning, live-ops & analytics depth

- **WAR-1 — Goal/target countdown overlay on the war-room wall.** The wall shows absolute scores with no target line, deadline countdown, or "movement since kickoff" though the goals system + window/baseline deltas exist. `live-war-room.md`
- **PPL-1 — Delivery has no trend-over-time view.** `getOrgPrSignals`/`getOrgGovernance` read only each repo's latest scan though `prStats`/`governance` are fully historical and the windowing helpers exist. `people-delivery-analytics.md`
- **OVR-1 — Multi-org portfolio / cross-org standing.** `OrgSwitcher` switches one tenant at a time; bare `/org` just redirects; nothing aggregates the several orgs a viewer can access (natural paid-tier hook). `org-overview-standing.md`

### Theme 6 · Onboarding activation & CI gate

- **ONB-1 — First scan is always mock — onboarding shows fabricated maturity scores.** `importScan.ts:63` hardcodes `mock:true` though the import route fully supports real credit-metered scans — undermines the core activation/trust moment. `first-run-onboarding-wizard.md`
- **GATE-1 — No persisted per-org/per-repo gate policy (the App Check ignores any configured bar).** Policy is only ad-hoc per request; the App-mode Check Run (the actual merge blocker) calls bare `evaluateGate` with no policy. `ci-gate-status-checks.md`

---

## The 56 high-value findings — by theme

### A. Close the action loop (continued)
- **BKLG-2** — Promote a backlog item into a tracked Initiative (`createInitiative` is called from nowhere yet). `backlog-management.md`
- **PLAY-2** — Bulk-apply a playbook to a segment / the whole fleet. `playbooks.md`
- **PLAY-3** — Promote a mined practice into a reusable playbook (the two panels never hand off). `playbooks.md`
- **PRAC-2** — Track applied practices + re-score delta (every apply is audit-logged but never read back). `practices-governance-adoption.md`
- **SIM-3** — ROI ranking: "where should we invest?" auto-recommendation (engine has the math, single-repo only). `investment-simulator-forecast.md`
- **SIM-4** — Couple the forecast to the simulator ("this fix moves your ETA 8mo→3mo"). `investment-simulator-forecast.md`
- **GOAL-3** — `practiceId` initiative→Practice-Library link is stored end-to-end but never set or surfaced (dead wiring). `goals-initiatives.md`
- **GOAL-6** — Goals & initiatives are disconnected — completing an initiative doesn't move its goal. `goals-initiatives.md`
- **ONB-3** — Scan-complete rows dead-end — no drill-in to the report just generated. `first-run-onboarding-wizard.md`
- **MAP-2** — No way to scan unscanned/stale repos from the map (despite `/api/org/scan` + `OrgScanButton`). `launch-fleet-map.md`

### B. Expose dormant backends (continued)
- **MEM-2** — No invite flow (no Invite model); owners can only assign roles to logins they already know. `members-access-control.md`
- **MEM-4** — No way to remove a member — access is grant-only, never revoked (route has GET+POST, no DELETE). `members-access-control.md`
- **ALRT-3** — Regression thresholds are hardcoded — no per-org sensitivity config (`detectRegression` already takes a threshold arg). `fleet-alerts-digests.md`
- **STD-2** — Manifest advertises `evals/` + `.ai/guardrails.yaml` that `buildFoundation()` never scaffolds. `ai-native-standard-onboarding-skill.md`
- **STD-3** — Track multiselect (`SelectOpts.include`) built+tested but unreachable from the API. `ai-native-standard-onboarding-skill.md`
- **STD-4** — No "install the `.ai/` foundation" PR — adoption is copy-paste-from-markdown only. `ai-native-standard-onboarding-skill.md`
- **CONN-2** — Per-repo scan health (`lastScanStatus`/`lastScanError`) tracked + shown on the dashboard but stripped from the connect screen. `connect-repo-selection.md`
- **CONN-3** — No "scan selected now" from the selection screen (reuse the `/api/org/import` SSE batch scanner). `connect-repo-selection.md`
- **PPL-2** — Per-repo PR breakdown on the delivery tab — computed `PrStats` fields exist but only fleet means are surfaced. `people-delivery-analytics.md`

### C. Notifications: email + alert reach
- **ALRT-2** — Single webhook channel only — no email or native Slack/Teams delivery. `fleet-alerts-digests.md`
- **ALRT-4** — No alert history / acknowledgement surface (credit alerts aren't even audited). `fleet-alerts-digests.md`
- **OVR-2** — Email delivery of the period summary / briefing (push is Slack-only; zero email-send code). `org-overview-standing.md`
- **USE-3** — No usage-spend budget or anomaly alert (alerts are maturity-only). `usage-metering-public-badge.md`
- **PRAC-4** — Governance & adoption are absent from the weekly digest. `practices-governance-adoption.md`
- **SEG-2** — No per-segment digest — leaders can't get a weekly push for the slice they own (rollup/movers already accept `segmentId`). `repositories-segments.md`

### D. Monetization & funnel (continued)
- **CRED-2** — Activate the `pro`/`team` plan tiers (only `enterprise` is read anywhere). `credits-entitlements.md`
- **CRED-3** — Auto-recharge (low-balance automatic top-up). `credits-entitlements.md`
- **QUOTA-3** — No live "scans left" meter before the user commits to a scan (count only surfaces post-scan via headers). `quotas-rate-limiting.md`

### E. Planning & live-ops depth
- **GOAL-2** — Initiatives have no owner/assignee/due date (the Recommendation model already has them). `goals-initiatives.md`
- **SIM-2** — Multi-dimension / stacked investment scenarios (`simulateFleet` takes a single fix). `investment-simulator-forecast.md`
- **WAR-2** — Campaign baseline: "movement since the push started" (`getOrgRollup` already returns a baseline snapshot). `live-war-room.md`
- **WAR-3** — Auto re-arm / live loop for an unattended wall display (currently manual single-shot). `live-war-room.md`
- **WAR-4** — Kiosk/TV mode: fullscreen + screen wake-lock + shareable read-only link. `live-war-room.md`
- **MAP-3** — Map shows no movement — no risers & fallers / "what changed" (org page already has `getOrgMovers`). `launch-fleet-map.md`

### F. Delivery & people analytics
- **PPL-3** — Contributor & team drill-down (no `[login]` detail route, no deep-links). `people-delivery-analytics.md`
- **PPL-4** — DORA-style delivery framing (lead time, change-fail proxy, throughput). `people-delivery-analytics.md`

### G. CI gate completeness
- **GATE-2** — No "rescan"/re-run action on the Check Run (rerequested events dropped). `ci-gate-status-checks.md`
- **GATE-3** — Scan failure leaves the required Check missing instead of a `neutral` "couldn't evaluate". `ci-gate-status-checks.md`

### H. Audit & compliance
- **SEC-1** — Audit-trail export (CSV/JSON) for compliance evidence (every sibling API has export). `security-posture-audit-log.md`
- **SEC-2** — Audit viewer can't filter by date range or actor though the API already supports `since`/`until`/`actorId`. `security-posture-audit-log.md`
- **SEC-3** — *(bug)* Recommendation-update audit entries are mislabeled (`recommendation.status_changed` in the viewer vs `recommendation.updated` recorded) — the filter matches nothing and 4 action types render as unknown. `security-posture-audit-log.md`
- **MEM-3** — Privilege changes write no audit entry — the one mutation that most needs a trail (`recordAudit` + viewer exist). `members-access-control.md`

### I. Growth / SEO / shareability
- **USE-1** — Badge funnel is unmeasured — no impression/click analytics or `?ref=badge` acquisition tag. `usage-metering-public-badge.md`
- **USE-2** — No numeric-score or per-dimension badge variant (report already carries the scores). `usage-metering-public-badge.md`
- **SHELL-1** — Per-repo OG card renders only the repo name though `generateMetadata` already fetches the score — throws away the "look at our number" viral moment. `app-shell-seo-error-pages.md`
- **SHELL-2** — Org/fleet pages have no shareable metadata or OG image (monetized tier; blank exec forwards). `app-shell-seo-error-pages.md`

### J. Reporting / overview / exec polish
- **OVR-3** — Drill-everywhere from the overview aggregates into a filtered repo list (static tiles today). `org-overview-standing.md`
- **EXEC-2** — Briefing omits the `getOrgRecommendations` "what to do next" list it already computes. `executive-briefing.md`
- **EXEC-3** — LLM-written executive narrative (the full provider layer is idle; briefing is pure template). `executive-briefing.md`
- **ONB-2** — No resumability — refresh/nav/auth-bounce drops the user to step one (all wizard state in `useState`). `first-run-onboarding-wizard.md`
- **ONB-4** — No "what your score means" moment — scores land with zero interpretation. `first-run-onboarding-wizard.md`

### K. Abuse / reliability backstops
- **QUOTA-2** — Rate limiter is per-instance in-memory — no distributed/durable backstop. `quotas-rate-limiting.md`

---

## Triage themes

| Theme | Approx count (C+H) | Why it's a wave, not isolated fixes |
|---|---:|---|
| 1. Close the action loop (insight → draft-PR / tracked work) | 6C + ~10H | All reuse the SAME two built primitives — `openDraftPr` and `createInitiative`. Wiring them into backlog/sim/playbook/practice/doctor/map turns six read-only surfaces into the fleet's change-delivery mechanism. Highest leverage in the scan. |
| 2. Expose dormant backends (management UI) | 4C + ~6H | Every item is "backend + tests done, add a settings/management UI". One mental model (find the shipped capability, add its surface), uniformly high ROI. |
| 3. Notifications: email channel + targeted alerts | 3C + ~6H | All build on `alerts.ts`/`dispatchAlert` + the audit/aggregate data. Adding an email transport once + new triggers (goal-at-risk, security, spend) unlocks them together. |
| 4. Monetization & conversion funnel | 2C + ~3H | The revenue plumbing (credits/ledger/402/quota) is built; what's missing is the *purchase + upgrade* surface. Stripe Checkout + an upgrade CTA at the block + plan tiers ship as one payment vertical. |
| 5. Planning loop completeness (goals/initiatives/sim) | 1C + ~6H | All in `db/plan.ts` + the plan UI; owner/assignee/due + goal↔initiative↔practice links + multi-dim/ROI sim make planning a real workflow, not parallel lists. |
| 6. Live ops: War Room + Fleet Map | 1C + ~5H | Centered on `live/page.tsx` + the map; share the goals/rollup window model and the "make it live + interactive" mental model. |
| 7. Audit & compliance + CI gate | 1C + ~6H | `security`/`audit` + `gate`; export + filters + the action-name bug + privilege audit + gate policy/neutral/rescan are an enterprise-trust bundle. |
| 8. Growth / SEO / shareability | 0C + 4H | `badge` route + OG-image surfaces; badge analytics/variants + OG score cards are the acquisition/virality loop. |
| 9. Onboarding activation | 1C + 2H | `onboarding/*`; real first scan + resumability + score explainer drive activation/conversion. |
| 10. Delivery & people analytics | 1C + 3H | `org-signals`/`org-contributors`; trend-over-time + per-repo breakdown + drill-down + DORA framing. |
| 11. Multi-org / overview | 1C + 1H | Cross-org portfolio + drill-everywhere; a paid-tier surface for multi-org owners. |

(Mediums = 49, Lows = 4 — itemized in the per-context reports; many are sub-features of the themes above.)

---

## Suggested next-phase split (wave plan)

Each wave is one sessionable theme (5–7 findings) with a shared mental model so the fixes compound. Ordered by value × cohesion.

- **Wave 1 — Close the action loop (Theme 1).** BKLG-1, SIM-1, PLAY-1, PRAC-1, MAP-1, STD-1. *Reuse `openDraftPr`/`createInitiative` to turn six dead-end surfaces into action. The single highest-leverage wave — small, uniform wire-ups over finished backends.*
- **Wave 2 — Expose dormant backends / management UIs (Theme 2).** MEM-1 (+MEM-2, MEM-4), ALRT-1 (+ALRT-3), SEG-1, CONN-1. *Member management + alert config + segment-scoped scan/cadence + bulk watch — all "add the UI to a shipped backend."*
- **Wave 3 — Notifications: email + targeted alerts (Theme 3).** ALRT-2 (email transport), GOAL-1, SEC-4, USE-3, OVR-2, ALRT-4. *Add an email channel once, then wire the high-value triggers the data already supports.*
- **Wave 4 — Monetization funnel (Theme 4).** CRED-1 (Stripe Checkout), QUOTA-1 (upgrade CTA at the block), CRED-2 (plan tiers), CRED-3 (auto-recharge), QUOTA-3 (scans-left meter). *The revenue vertical; turns built accounting into actual income.*
- **Wave 5 — Planning loop completeness (Themes 1+5).** ✓ **DONE (7/7)** — BKLG-2, GOAL-2, GOAL-3, GOAL-6, SIM-2, SIM-3, SIM-4. *Made goals/initiatives/simulator one connected workflow.* See `FIXES-WAVE-5.md`.
- **Wave 6 — Live ops: War Room + Map (Theme 6).** WAR-1, WAR-2, WAR-3, WAR-4, MAP-2, MAP-3. *Make the wall + map genuinely live, goal-aware, and interactive.*
- **Wave 7 — Audit/compliance + CI gate (Themes 7).** SEC-3 (bug), SEC-1, SEC-2, MEM-3, GATE-1, GATE-2, GATE-3. *Enterprise-trust bundle; lead with the SEC-3 audit-filter bug.*
- **Wave 8 — Growth/SEO + onboarding activation (Themes 8+9).** ✓ **DONE (8/8)** — SHELL-1, SHELL-2, USE-1, USE-2, ONB-1, ONB-2, ONB-4, ONB-3. *Acquisition (OG/badge) + first-run activation.* See `FIXES-WAVE-8.md`.
- **App Shell / SEO.** ✓ **DONE (5/5)** — SHELL-1/2 (Wave 8) + SHELL-3 (PWA manifest), SHELL-4 (JSON-LD + metadataBase), SHELL-5 (sitemap routes). See `FIXES-SHELL-SEO.md`.
- **Mediums Wave A · Segments & fleet slicing.** ✓ **DONE (6/6)** — bulk tag endpoint + auto-add-by-language, chip rename/recolor + empty-state link, leaderboard CSV + bulk bar, Delivery/Teams segment scoping, connect-time segment picker, fleet-map filter/sort. See `FIXES-MEDIUMS-A-SEGMENTS.md`.
- **Mediums Wave B · Adaptive org overview.** ✓ **DONE (3/3)** — goal-vs-actual tiles (OVR-6), remember-my-period cookie (OVR-5), collapsible/persisted sections (OVR-4). See `FIXES-MEDIUMS-B-OVERVIEW.md`.
- **Mediums Wave E · Access control & safety.** ✓ **DONE (3/3)** — last-owner demotion guard (MEM-5), self-service role badge (MEM-6), onboarding team-invite (ONB-5). See `FIXES-MEDIUMS-E-ACCESS.md`.
- **Mediums Wave C · Planning & goals depth.** ✓ **DONE (5/5)** — suggested goals (GOAL-5), save/compare scenarios (SIM-5), goal achieved state (GOAL-4), playbook↔initiative bridge (PLAY-5), cheapest-path worklist (PRAC-6). See `FIXES-MEDIUMS-C-PLANNING.md`.
- **Mediums Wave D · Playbooks & practices authoring.** ✓ **DONE (3/3)** — starter templates (PLAY-4), versioning + history (PLAY-6), org-authored practice + preview (PRAC-5; the apply-PR shipped in PLAY-1). See `FIXES-MEDIUMS-D-PLAYBOOKS.md`.
- **Remaining / optional.** Delivery analytics depth (PPL-1, PPL-2, PPL-3, PPL-4), multi-org (OVR-1, OVR-3), exec narrative (EXEC-2, EXEC-3), governance digest/policy (PRAC-2, PRAC-3, PRAC-4), standard scaffolding (STD-2, STD-3, STD-4), playbook promotion (PLAY-2, PLAY-3), per-segment trends (SEG-2, SEG-3), abuse backstop (QUOTA-2), plus the 49 mediums + 4 lows.

---

## How this scan was run

- **Scanner**: `feature_scout` role from `src/lib/prompts/registry/agents/feature-scout.ts` (Vibeman registry), run as 22 isolated `general-purpose` subagents (Vibeman Pipeline B).
- **Date**: 2026-06-14. **Project**: `ascent` (id `847cd027…`), Next.js — full-stack, no backend side-split. **Target**: 4–6 findings/context.
- **Context map**: regenerated this session via the Vibeman CLI full-regeneration (`/api/context-generation/execute`) — 10→38 contexts / 4→9 groups, 100% source coverage (284/284 files), replacing a map that was 317 commits / ~12 days stale.
- **Scope**: the 22 contexts in 6 newer/less-scouted groups; the mature scan/scoring/identity/reporting core (already heavily scouted on 2026-06-08 and largely fixed) was deliberately excluded.
- **Method**: each subagent read its context's in-scope files + followed imports, then grep-confirmed every gap was genuinely missing (not already implemented — prior scans closed many, e.g. OpenAI provider, cost panel, credits/quota, per-row rescan, fleet digest cron, session revoke, trajectory forecast) before listing it, and wrote one structured report. The orchestrator read only terse subagent replies during scanning, then compiled this INDEX.
- **Verification**: findings counted two ways — 22 `> Total:` headers (=129) and 129 `- **Severity**:` bullets; both agree. Severity split 20C / 56H / 49M / 4L.
- **Baseline (for fix-wave regression checks)**: `tsc --noEmit` 0 errors; **vitest 450/450 passing (54 files)**; eslint clean.
