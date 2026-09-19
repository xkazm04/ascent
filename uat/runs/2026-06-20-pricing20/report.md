# Run scorecard — pricing-20 x repeated-org-scans-worth-the-price (L1 sweep)

**Date:** 2026-06-20 | **Level:** L1 (theoretical, code-grounded, no browser) | **L2 engine queued:** LLM_PROVIDER=claude-cli | **Characters:** 20 | **Findings:** 126 (120 per-character + 6 consolidated PANEL) | **Strengths:** 34

The whole sweep asked ONE question across 20 buyers/operators: **does *repeated* use of the org scan bring value worth the price?** Every character walked the same journey at their own tier, stack, and situation.

## The 20-character scorecard

| # | slug | size | stack | tier | L1 verdict | PRICING | time-saved/cycle | grounding | sharpest finding |
|---|------|------|-------|------|-----------|---------|------------------|-----------|------------------|
| 1 | priyanka-indie-solo | 1 dev | Next/TS | Free | conditional | **downgrade** (stay Free) | ~10 min | 3/5 | Free "30-day history" never enforced — phantom boundary |
| 2 | yusuf-bootstrapped-rails | 7 eng | Rails monolith | Pro | conditional | **downgrade** | ~8-10 min | 4/6 | Pro $ invisible in-app — cost-value cannot close |
| 3 | lena-seed-node-cto | 15 eng | Node/TS svcs | Team | conditional | **downgrade** (Team to Pro) | ~105 min/qtr | 4/6 | Subscription price invisible — cannot close board ROI |
| 4 | gabriel-seriesb-vp | 120 eng | Go+TS+Py | Team to Ent | conditional | **upgrade** (forced, reluctant) | ~24-32 hr/qtr | 4/5 | No burn-vs-allotment ceiling — learns 500 cap via the 402 |
| 5 | anika-jvm-platform | 400 eng | Java/Kotlin/Gradle | Ent | conditional | **renew** (conditional) | ~8-10 hr (of ~20 promised) | 5/7 | Gradle .kts builds unread — .kts-only repo stably under-read |
| 6 | robert-enterprise-dotnet | 2000 eng | .NET+legacy | Ent+SSO | conditional | **renew** (conditional) | ~4-8 hr/qtr | 5/6 | Weekly digest fires "no change this week" — trains the inbox filter |
| 7 | sasha-megacorp-buildvsbuy | 10k eng | every stack | eval | conditional | **downgrade** (Team to Pro) | ~3-4 hr | 4/6 | No bulk export of fleet scores/trajectory — renting own data back |
| 8 | bruno-agency-principal | agency | clients repos | Team | conditional | **upgrade-blocked (lean churn)** | ~0 realized (~28 hr/mo possible) | 3/6 | White-label Enterprise-only + no per-client briefing — cannot resell |
| 9 | helena-ma-techdd | advisor | target repos | resists sub | conditional | **churn** (priced wrong) | ~2-4 hr/rescan | 5/7 | No idle-floor/subscription signal — cannot confirm "pay-per-burst" |
| 10 | theo-pe-portfolio | ~15 cos | polyglot | Ent | conditional | **renew** (hold Ent) | ~20-24 hr/qtr | 4/5 | No fleet-of-fleets — 15 portcos onto one slide is still manual |
| 11 | mariam-fintech-audit | 80 eng | Java/Scala | Team to Ent | conditional | **renew, do NOT upgrade** | ~2 hr (of ~14 promised) | 4/6 | retentionDays dead — Enterprise "custom retention" upsell buys air |
| 12 | owen-healthtech-privacy | 60 eng | wants Bedrock | Pro/Ent | conditional | **upgrade** (to Ent, conditional) | ~16 hr/mo (if Bedrock) | 6/7 | Bedrock is deployment Phase-2 — privacy engine unreachable at Pro |
| 13 | diane-gov-onprem | contractor | .NET/Java air-gap | Ent | conditional | **blocked-renew (lean churn)** | ~7 hr (currently $0 realized) | 4/7 | No air-gap engine + GitHub host hardcoded — cannot run in boundary |
| 14 | kenji-oss-foundation | foundation | public repos | Free fvr | conditional | **renew Free / never convert** | ~2-3 hr | 2/4 | No OSS-shaped paid hook — unlimited value, zero conversion path |
| 15 | camille-devtools-vendor | rival PMM | competitor | skeptic | conditional | **renew (cond) to churn on stable fleet** | ~2-3 hr | 4/6 | Movers wear the same badge as signal — 12-week churn clock |
| 16 | arjun-ml-platform | 50 eng | Python/notebooks/ML | Team | **FAIL** | **churn** (blocked on fit) | net-negative (debunk chore) | 4/6 | Notebooks invisible end-to-end + no ML archetype — mismeasures |
| 17 | sofia-mobile-em | 90 eng | Swift/Kotlin | Team | conditional | **downgrade** | ~160 min/train (~0 on D3) | 4/5 | D3 delivery blind to mobile — grades release train as a JVM build |
| 18 | klaus-embedded-firmware | 25 eng | C/C++/Rust low-velocity | Pro | conditional | **renew (cond, downgrade-watch)** | ~20-30 min/mo | 4/6 | Movers banner states +N with no noise guard (+ no embedded lens) |
| 19 | tania-scaleup-costcut | 150 eng | mixed | Team (renewal) | conditional | **downgrade (lean churn)** | ~0 realized (~3 hr possible) | 3/6 | No human-engagement signal — /usage proves cron, not a person |
| 20 | victor-finops-director | 300 eng | mixed | Team | conditional | **renew (for now), downgrade-curious** | ~0 realized (~30 min possible) | 2/5 | /usage shows burn but never "X of 500" — cannot right-size the tier |

**Verdict tally:** 1 L1-fail (Arjun), 19 L1-conditional, **0 clean L1-pass.** Every journey completes structurally but carries a major recurring-value or pricing-legibility finding — none is clean to L2.

**Pricing tally:** renew 6 (Anika, Robert, Theo, Mariam, Klaus, Victor — mostly conditional/Enterprise) | downgrade 6 (Priyanka, Yusuf, Lena, Sasha, Sofia, Tania) | churn 3 (Helena, Arjun, Camille-on-stable) | upgrade 3 (Gabriel forced, Owen conditional, Bruno-blocked) | 2 special (Kenji renew-Free-never-convert, Diane blocked-renew). **Net: only the Enterprise-by-design buyers and the cheap-honest-watch buyers hold; every priced mid-market buyer downgrades or churns, and the gating reason is almost never the read — it is price legibility, stack-fit, or a missing recurring-value surface.**

## Confirmed-findings counts

### By severity (126 findings; none refuted — ~112 confirmed, ~14 uncertain pending L2)
| severity | count | notes |
|----------|-------|-------|
| blocker | 5 | Bruno white-label (resale-blocking); Diane air-gap engine + GHES host; Arjun no-ML-archetype + notebooks-invisible |
| major | 57 | the recurring-value & pricing-legibility body (incl. all 6 PANEL consolidations) |
| minor | 33 | per-dimension noise, retention-decorative-for-this-char, cohort instability |
| polish | 31 | the 34 strengths (mostly polish) + small clarity gaps |

The ~14 uncertain are the re-scan-wobble claims that L2 under claude-cli must empirically confirm (does an unchanged repo actually move within the +/-25 guardband, and is it surfaced as a mover with no noise tag).

### By dimension
| dimension | count | the recurring theme it carries |
|-----------|-------|--------------------------------|
| trust | 41 | move-is-real defense not co-located with the move; retention phantom; tamper-evidence; meter-vs-marketing |
| missing | 24 | fleet adoption curve, fleet-of-fleets, bulk export, per-client briefing, human-engagement, burn-vs-allotment |
| clarity | 19 | invisible price (the most-raised), credit-rollover unstated, no stack-fit caveat |
| senior-quality | 14 | stack-fit (Gradle/.ipynb/mobile-D3/embedded), commodity scoring, mock thinness |
| completion | 14 | strengths (PeriodSummary, briefing, audit CSV) + air-gap deployability |
| effort / time-saved | 14 | burn legible but half-the-math; usage ledger; new-story-each-cycle |

### Most-raised defects (the cross-cohort signal)
1. **Invisible price** — 16/20 characters (PANEL-01)
2. **Noise/confidence absent on movers/briefing/dimension/alert** — 15/20 (PANEL-03)
3. **Dead retentionDays** — independently verified by 6 characters (PANEL-02)
4. **Stack-fit stably-wrong for non-web** — 4/20, one of them the sole L1-fail (PANEL-05)
5. **Monetization & value-realization leaks** — 5/20 (PANEL-06)
6. **Credit rollover unstated vs "/month" copy** — 3/20 (PANEL-04)

## What passed — strengths worth protecting (34 strength findings)

- **The trajectory GPS statistical honesty (universal applause).** forecastTrajectory returns null below 2 distinct calendar days (so repetition genuinely earns the feature); FLAT_PER_WEEK=0.5 collapses sub-noise drift to "Holding around N — no level change projected" rather than inventing a slope; R2 renders as "trend confidence N% . noisy" below 50%. Praised by ~14 characters — the one feature nearly everyone trusts. `src/lib/maturity/forecast.ts:64,87,100,131` / `src/components/org/Trajectory.tsx:88-97`.
- **Cron rescan: unchanged-commit dedup + credit refund + alert suppression.** A literally-unchanged repo autoscan writes no metered row, refunds the credit, and fires no regression alert — cost tracks new information, not the calendar. The load-bearing fact behind Klaus and Robert renewing. `src/lib/db/scans-persist.ts:144-148` / `src/app/api/cron/rescan/route.ts:136,138`.
- **Cross-org corpus percentile.** Ranks the org against every repo Ascent has scored + a same-language peer cohort, with CORPUS_MIN/COHORT_MIN statistical-floor gates so a tiny corpus does not lie. The single thing Sasha (build-vs-buy) structurally cannot reproduce; a moat Camille (rival) cannot answer. `src/lib/db/org-insights.ts:549,556-627`.
- **Tier-agnostic PDF / markdown / CSV export.** Download PDF + Copy-for-LLM + per-scan CSV are read-gated, not tier-gated — Helena clean export-and-cancel exit. `src/app/api/org/briefing/pdf/route.ts:24` / `src/app/api/history/route.ts:104`.
- **Per-engine privacy provenance + honest fallback.** The inference hop is disclosed in-product per engine (<=32 files, named provider, separated from persistence); every scan records engineProvider so a degraded/mock cycle is visible (not laundered) in the trend; a selected real provider fails fast rather than silently mocking. Owen strongest reason to trust a mixed-engine fleet. `src/components/connect/PrivacyNotice.tsx:15-58` / `src/lib/db/scans-persist.ts:203` / `src/components/report/ReportHeader.tsx:40-51`.
- **Cohort-matched period deltas.** computeWindowDeltas measures movement only over repos present on both sides of the window, so onboarding a repo mid-period does not fabricate a swing. Trusted by Anika, Theo, Mariam, Sofia. `src/lib/db/org-rollup.ts:130-145`.
- **Self-contained digest artifact.** buildFleetDigestMessage carries the decision in the body (score+level+delta, trajectory headline, named movers, the one highest-leverage gap, percentile) — the dashboard link is the last line. Robert chiefs-of-staff doc, automated. `src/lib/alerts.ts:167-208`.
- **Credit reconciliation ledger.** debited / refunded / granted / net against an append-only ledger stamping balanceAfter per row — the audit row Victor (FinOps) trusts on sight. `src/app/usage/page.tsx:247-269` / `src/lib/db/credits.ts:227-241`.
- **Audit CSV hygiene.** Org-scoped, keyset-paginated, RFC-4180 + formula-injection-hardened — Diane (gov) notes it reads as built by someone who has handled evidence. `src/app/api/audit/route.ts:24-31`.
- **Recommendation action lifecycle.** Full status lifecycle + append-only attributed event timeline, tenant-gated (403 on the public funnel) — the real value-realization primitive Tania needs, just not surfaced org-wide. `prisma/schema.prisma:333-380`.

**What NOT to touch:** the forecast null-below-2-days gate, the FLAT_PER_WEEK floor, the R2/"noisy" surfacing, the dedup+refund path, the cohort-matched delta math, the corpus statistical-floor gates, and the per-engine provenance. These are the spine of the product credibility — the fixes below add to them, they do not modify them.
