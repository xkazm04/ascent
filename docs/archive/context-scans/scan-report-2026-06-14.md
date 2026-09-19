# Context Scan Report

**Date**: 2026-06-14
**Project**: ascent
**Project ID**: 847cd027-0e92-434d-914d-d94463e00895
**Project Type**: Next.js 16 (App Router) + Prisma/Aurora DSQL + Supabase auth

## Execution Summary

| Metric | Value |
|--------|-------|
| Groups created | 9 |
| Contexts created | 38 |
| Relationships created | 20 |
| Source files covered (`.ts`/`.tsx`) | 339 / 339 (100%) |
| Total file paths mapped (incl. docs/prisma/css) | 345 |
| Pre-existing groups (auto-cleaned) | 4 |
| Pre-existing contexts (auto-cleaned) | 10 |

The previous scan (2026-05-30) mapped ~80 files into 4 groups / 10 contexts. The
codebase has since grown to **339 source files**, so this pass rebuilt the map
comprehensively. The 4 old groups / 10 old contexts remain in the DB and will be
cleaned up automatically.

## Created Groups

| # | Group | Domain | Color | ID |
|---|-------|--------|-------|----|
| 1 | Repository Scanning & Scoring | feature | #3B82F6 | group_1781395138214_hcq0p88 |
| 2 | Identity & GitHub Connectivity | integration | #0EA5E9 | group_1781395138227_cxkddfh |
| 3 | Onboarding, Shell & AI Standard | feature | #EC4899 | group_1781395138236_79841zs |
| 4 | Org Scanning & Fleet Rollups | data | #F59E0B | group_1781395138242_2bqh3cd |
| 5 | Org Dashboard & Analytics | feature | #F97316 | group_1781395138249_17k2i46 |
| 6 | Org Planning & Execution | feature | #8B5CF6 | group_1781395138256_v8656qb |
| 7 | Reporting & Visualization | feature | #10B981 | group_1781395138263_hqw67y6 |
| 8 | Billing, Credits & Metering | feature | #06B6D4 | group_1781395138269_445cp8q |
| 9 | Data & Persistence | data | #6366F1 | group_1781395138274_16uwj46 |

## Created Contexts

| # | Context | Group | Files | Category | ID |
|---|---------|-------|-------|----------|----|
| 1 | Scan Pipeline & Ingestion | Scanning & Scoring | 15 | api | ctx_1781395138281_92iw5nr |
| 2 | Maturity Model & Scoring Engine | Scanning & Scoring | 15 | lib | ctx_1781395138290_3qe5yxg |
| 3 | LLM Provider Abstraction | Scanning & Scoring | 15 | lib | ctx_1781395138297_wl68qx5 |
| 4 | CI Gate & Status Checks | Scanning & Scoring | 7 | api | ctx_1781395138304_8m6ykzv |
| 5 | GitHub OAuth & Session | Identity & GitHub | 16 | api | ctx_1781395138330_b44bqe9 |
| 6 | GitHub App Installation & Webhooks | Identity & GitHub | 8 | api | ctx_1781395138337_mf59hwn |
| 7 | GitHub Repo Data Access | Identity & GitHub | 8 | lib | ctx_1781395138345_dj91oku |
| 8 | First-Run Onboarding Wizard | Onboarding/Shell | 9 | ui | ctx_1781395138351_ao9n63s |
| 9 | Connect & Repo Selection | Onboarding/Shell | 6 | ui | ctx_1781395138357_etgimrc |
| 10 | Launch Fleet Map | Onboarding/Shell | 5 | ui | ctx_1781395138363_3z44ljj |
| 11 | AI-Native Standard & Onboarding Skill | Onboarding/Shell | 14 | lib | ctx_1781395138369_ptl6zcu |
| 12 | App Shell, SEO & Error Pages | Onboarding/Shell | 11 | ui | ctx_1781395138375_zafkcy8 |
| 13 | Org Import, Scan & Watchlist | Org Scanning | 16 | api | ctx_1781395138381_bz6ksdz |
| 14 | Fleet Rollups & Insights | Org Scanning | 9 | data | ctx_1781395138388_m25de03 |
| 15 | Members & Access Control | Org Scanning | 6 | data | ctx_1781395138393_xasurp2 |
| 16 | Fleet Alerts & Digests | Org Scanning | 5 | lib | ctx_1781395138400_3qf3vta |
| 17 | Org Overview & Standing | Org Dashboard | 12 | ui | ctx_1781395138406_k4zewxy |
| 18 | People & Delivery Analytics | Org Dashboard | 3 | ui | ctx_1781395138411_8uej88t |
| 19 | Practices, Governance & Adoption | Org Dashboard | 12 | ui | ctx_1781395138416_uu6vaf7 |
| 20 | Repositories & Segments | Org Dashboard | 10 | ui | ctx_1781395138423_9gvzchc |
| 21 | Security Posture & Audit Log | Org Dashboard | 9 | ui | ctx_1781395138429_2gp6ik3 |
| 22 | Goals & Initiatives | Org Planning | 10 | ui | ctx_1781395138435_qfvrenz |
| 23 | Backlog Management | Org Planning | 6 | ui | ctx_1781395138442_li5cqe2 |
| 24 | Playbooks | Org Planning | 8 | ui | ctx_1781395138447_pr7xeih |
| 25 | Investment Simulator & Forecast | Org Planning | 6 | lib | ctx_1781395138453_fwbg4ft |
| 26 | Live War Room | Org Planning | 9 | ui | ctx_1781395138460_vtxlcev |
| 27 | Executive Briefing | Org Planning | 5 | ui | ctx_1781395138466_83nsu9i |
| 28 | Repo Report Shell & Tabs | Reporting | 15 | ui | ctx_1781395138472_izlxkeg |
| 29 | Score Charts & Visuals | Reporting | 14 | ui | ctx_1781395138478_1ntolrm |
| 30 | Trends & Comparison | Reporting | 14 | ui | ctx_1781395138522_xww7fmf |
| 31 | Roadmap & Recommendation Tracking | Reporting | 8 | api | ctx_1781395138529_j82qxnf |
| 32 | PDF & LLM Export | Reporting | 3 | api | ctx_1781395138537_2w0szvq |
| 33 | Usage Metering & Public Badge | Billing | 8 | api | ctx_1781395138543_dcal74w |
| 34 | Credits & Entitlements | Billing | 9 | lib | ctx_1781395138549_03p5mgv |
| 35 | Quotas & Rate Limiting | Billing | 4 | lib | ctx_1781395138555_bt2rtdp |
| 36 | Database Client & Schema | Data & Persistence | 7 | data | ctx_1781395138561_8bxwb6x |
| 37 | Scan Persistence & History | Data & Persistence | 5 | data | ctx_1781395138567_zj3t1t7 |
| 38 | Data Retention & Purge | Data & Persistence | 3 | data | ctx_1781395138573_7fbplm9 |

## Group Relationships (20)

```
Org Scanning      --depends_on--> Scanning & Scoring   (fleet scans invoke the per-repo engine)
Scanning & Scoring --uses-------> Identity & GitHub     (snapshot/PR/governance fetch)
Scanning & Scoring --depends_on-> Data & Persistence    (scores persisted)
Scanning & Scoring --triggers---> Billing               (each scan meters usage/credits)
Reporting         --uses-------> Scanning & Scoring     (renders scoring output)
Reporting         --depends_on-> Data & Persistence     (reads scans/history)
Org Dashboard     --uses-------> Org Scanning           (reads fleet rollups/insights)
Org Dashboard     --depends_on-> Data & Persistence     (reads persisted org/scan data)
Org Planning      --uses-------> Org Scanning           (plans over fleet rollups)
Org Planning      --calls------> Scanning & Scoring     (simulator/forecast reuse scoring math)
Onboarding/Shell  --depends_on-> Identity & GitHub      (needs auth + installed App)
Onboarding/Shell  --triggers---> Scanning & Scoring     (kicks off first scans)
Identity & GitHub --uses-------> Data & Persistence     (sessions/installations persisted)
Billing           --depends_on-> Data & Persistence     (usage/credits/quota persisted)
Org Planning      --depends_on-> Data & Persistence     (goals/initiatives/backlog persisted)
Org Dashboard     --uses-------> Billing                (credit/quota controls on dashboard)
Org Scanning      --triggers---> Billing                (fleet scans consume credits)
Reporting         --triggers---> Onboarding/Shell       (report generates AI standard/skill)
Onboarding/Shell  --uses-------> Data & Persistence     (imports/reads persisted scans)
Org Planning      --uses-------> Reporting              (references report roadmaps/recs)
```

## Coverage Notes

- **Every `.ts`/`.tsx` source file under `src/` is mapped to exactly one context**
  (339/339). No overlaps, no gaps.
- Co-located `*.test.ts(x)` files are bundled into the context that owns the file
  under test (no separate "test" contexts).
- Non-source files included where they document/define a feature:
  `docs/MATURITY_MODEL.md`, `docs/CALIBRATION.md` (Maturity Model), `docs/ARCHITECTURE.md`,
  `prisma/schema.prisma`, `prisma/init.sql` (Database Client & Schema), `src/app/globals.css`
  (App Shell).
- Root-level non-`src` assets intentionally **not** mapped: `scripts/`, `bench/`, `e2e/`,
  `action.yml`, config files (`next.config.ts`, `vitest.config.js`, `playwright*.config.ts`,
  `eslint.config.mjs`, `tsconfig.json`), and the stray `Userskazdakiroverify_ideas.json` dump.

## Issues and Warnings

- ⚠️ Three contexts sit at the 15–16 file mark (GitHub OAuth & Session = 16;
  Org Import, Scan & Watchlist = 16; several at 15). These were kept whole because
  splitting would cut a cohesive feature (auth lifecycle; fleet-scan orchestration).
- ✓ All 38 contexts carry `category` + `business_feature`; all 9 groups carry `domain`.
- ✓ Every group participates in ≥1 relationship.
- ✓ No duplicate file across contexts.

## Verification

```bash
curl -s "http://localhost:3000/api/context-groups?projectId=847cd027-0e92-434d-914d-d94463e00895"
curl -s "http://localhost:3000/api/contexts?projectId=847cd027-0e92-434d-914d-d94463e00895"
curl -s "http://localhost:3000/api/context-group-relationships?projectId=847cd027-0e92-434d-914d-d94463e00895"
```

All 9 groups, 38 contexts, and 20 relationships confirmed persisted (API returns these
plus the soon-to-be-cleaned pre-existing entries).
