# Scan resume state — ambiguity-guardian + ui-perfectionist, 2026-07-16

Pipeline B on **ascent** (44 contexts, 5 findings/context, combined ambiguity+ui lens).
Session usage limit hit ~22:40; resets 3:20am Europe/Prague. Resume from here.

## Baseline (captured on master WITH user WIP in tree)
- tsc: 0 errors
- vitest: 3504/3504 passing (256 files, ~41s)
- master has uncommitted user WIP (~14 files + untracked uat/driver/*.mjs) — fix phase must use an isolated worktree off HEAD.

## Completed (31/44) — report file exists in this dir
ci-gate-status-checks, llm-provider-abstraction, maturity-model-scoring-engine,
scan-pipeline-ingestion, github-repo-data-access, github-app-installation-webhooks,
github-oauth-session, dev-inspector, app-shell-seo-error-pages,
ai-native-standard-onboarding-skill, launch-fleet-map, connect-repo-selection,
first-run-onboarding-wizard, fleet-alerts-digests, members-access-control,
fleet-rollups-insights, org-import-scan-watchlist, org-branding-white-label,
security-posture-audit-log, repositories-segments, practices-governance-adoption,
people-delivery-analytics, org-overview-standing, executive-briefing, live-war-room,
investment-simulator-forecast, playbooks, backlog-management, goals-initiatives,
pdf-llm-export, roadmap-recommendation-tracking

## Failed mid-scan (4) — re-dispatch these contexts (no report file, or partial)
- Quotas & Rate Limiting (slug quotas-rate-limiting)
- Repo Report Shell & Tabs (slug repo-report-shell-tabs) — agent noted ReportTabBar.tsx + ReportSkeleton.tsx no longer exist (context-map drift)
- Checkout & Plans (Polar) (slug checkout-plans-polar)
- Credits & Entitlements (slug credits-entitlements)

## In flight at cutoff (2) — check for report file; re-dispatch if missing
- Trends & Comparison (slug trends-comparison)
- Score Charts & Visuals (slug score-charts-visuals)

## Never dispatched (7)
- Usage Metering & Public Badge (usage-metering-public-badge)
- Data Retention & Purge (data-retention-purge)
- Scan Persistence & History (scan-persistence-history)
- Database Client & Schema (database-client-schema)
- Design System: UI Primitives & Deck (design-system-ui-primitives-deck)
- Landing Page Prototypes (landing-page-prototypes)
- Marketing About Page (marketing-about-page)

## Context file lists
Full per-context filePaths snapshot: fetch `GET http://localhost:3000/api/contexts?projectId=847cd027-0e92-434d-914d-d94463e00895`.

## Notable early signals (for INDEX themes later)
- Recurrent context-map drift: stale file paths in Live War Room, Backlog, Org Overview, Playbooks, Roadmap, Report Shell contexts.
- Gate/CI theme: unauthenticated gate param overrides org policy; fork-PR check posts default-branch verdict (structural gate bypass).
- Silent-fallback theme: LLM provider typo→auto, digest webhook misroute, import route missing BYOM exemption, briefing stack-scope fails open (scope escalation on share links).
- Dormant-auth remnants: /api/auth/session always signed-out; members self-demotion guard dead in prod.
- Broken Export CSV via backslash-in-template-literal URL (ui.tsx:289) — hard 404 on three pages.
- Privacy disclosures understated: PrivacyNotice ≤32 files vs MAX_FILES=50; adoption LLM brief bypasses CHAMPION_MIN_POP guard.

## After all 44 reports exist
1. Verify counts two ways (grep `^> Total:` sum vs `- **Severity**:` count).
2. Build INDEX.md (totals, per-context table, criticals one-liners, themes, wave plan).
3. Approval gate with user before any fixes; fixes on isolated worktree off HEAD.
