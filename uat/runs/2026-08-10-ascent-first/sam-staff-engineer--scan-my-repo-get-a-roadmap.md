# Sam (Staff Engineer) × `scan-my-repo-get-a-roadmap` — **L1 (theoretical, code-grounded)**

Run: `2026-08-10-ascent-first` · engine `/uat` v1.2 · cert level **L1** · no browser, no app run.
Character: `uat/characters/sam-staff-engineer.md`. Journey: `uat/journeys/scan-my-repo-get-a-roadmap.md`.
Grounding denominator: `uat/env.md` §Grounding, Surface A — **used verbatim, unmodified**.

---

## sources:

Surface model built by following the actual import chain from each affordance. Every path absolute-relative to `C:\Users\kazda\kiro\ascent`.

**Entry / scan form**
- `src/app/page.tsx:63-96` — landing (`/`), renders `IndexLanding`; `?scan=1` deep-link honored downstream.
- `src/components/landing/prototypes/index/ScanModal.tsx:58,153,183,231` — the scan input lives in a **modal**; trigger label "Scan a repository →"; `?scan=1` opens it; hosts `<ScanForm autoFocus showExamples={false}>`.
- `src/components/ScanForm.tsx:113-143` (`submit()`), `:161-190` (input), `:191-217` (Scan button + spinner), `:229-238` (error `role="alert"` + `role="status"`), `:241` (`ScanScopeFields`), `:252-285` (Try/Top-scored chips), `:18` (`FALLBACK_EXAMPLES`), `:33-37` (`treeRefFromPaste`), `:102-111` (bfcache reset). Navigates to `/report?repo=…`.

**Scan pipeline**
- `src/app/report/page.tsx:13-24` — `/report` → `<Suspense><ReportClient/></Suspense>`.
- `src/components/report/ReportClient.tsx:12-88` — reads `?repo`, `?fresh`, `?notify`, `?ref`, `?path`; branches idle/loading/error/done.
- `src/components/report/useReportScan.ts:76-345` — the lifecycle: peek `:149-171`, `POST /api/scan/stream` `:174-191`, quota headers `:241-247`, SSE frame dispatch `:256-294`, backstop timeout `:98-116`, terminal taxonomy `:325-332`.
- `src/app/api/scan/stream/route.ts:28-398` — SSE route: rate gate `:59`, auth gate `:87-93`, scope resolve `:103`, quota consume `:125-132`, heartbeat `:147-153`, cache lookup `:161-207`, coalesce `:264-279`, `classifyScanResult` `:284-285`, `willPersist` `:292`, `cacheAndPersistScan` `:301-310`, `result` frame `:330`.
- `src/app/api/scan/route.ts:110-120,174-215,512-540` — the peek/`GET` contract (`peek=1&recent=1`, `latest=1` salvage, GET-is-not-a-scan guard).
- `src/lib/scan-finalize.ts:1-115` — `consumeScanQuota`, `classifyScanResult`, the persist guards.
- `src/lib/scan-score-input.ts:57-122` — the deterministic → `LlmScoreInput` phase; D9 replacement `:73-78`, archetype `:79`, stack-fit `:84`, techStack `:88`, org decisions `:96-98`, the assembled `scoreInput` `:100-119` (tech-stack gate at `:118`).
- `src/lib/scoring/prompt.ts:81-83` (SYSTEM role + untrusted boundary), `:85-94` (rubric), `:125-132` (decisions block), `:138-173` (TASK + output contract), `:186-254` (`buildAssessmentPrompt`), caps at `:210-211,219`, commits `:224`, untrusted block `:244-251`.
- `src/lib/scoring/discrepancy-policy.ts:20,36-41` — `MAX_FLAGGED_DIMENSIONS = 2`, all-or-nothing budget.
- `src/lib/scoring/engine.ts:99-125` (budget application + capped warning), `:153` (`effectiveBlend = SCORE_BLEND * coverage`), `:200-211` (**band = ±25, doubled to ±50 for widened dims; blend formula**), `:250-268` (warnings), `:315-350` (report assembly incl. `scoreIntegrity`).
- `src/lib/maturity/model.ts:50` (`SCORE_BLEND = 0.6`), `:57` (`LLM_GUARDBAND = 25`).
- `src/lib/analyze/index.ts:90-102` (`Scorer.add/note` — `detail` is optional), `:190-211` (D1 detectors), `:252-299` (D2), `:329-336` (**assertion-substance detector**), `:363-386` (D3), `:844` (failure placeholder — the only `detail:` in the file).
- `src/lib/analyze/pulls.ts:214,229,243,267-292` — the only detectors that populate `Signal.detail`.
- `src/lib/types.ts:8` (`ProviderName` — 6 members), `:326-337` (`Signal` + `formatSignal`), `:339-350` (`DimensionSignals`), `:631` (`scoreIntegrity?`).

**Report surfaces**
- `src/app/report/[owner]/[repo]/page.tsx:70-93` (shell + Suspense masthead), `:102-177` (body; `ColdScanGate` at `:123`; concurrent reads `:137-142`), `:187-205` (server history/recs readers), `:211-224` (masthead).
- `src/components/report/ColdScanGate.tsx:19-70` — cold-permalink confirm gate.
- `src/components/report/ReportView.tsx:20-32` (`ALL_TABS`), `:69-107` (passport/history/recs state), `:162-165` (`computeReportSeries`), `:177-208` (URL-backed `?tab=`), `:213-269` (header → passport hero → warnings → SideNav → panels → **discrepancies** → CTA → "Scan another repo").
- `src/components/report/ReportPanels.tsx:37-100` — Scoring / Dimensions / Roadmap / Sandbox / Contributors.
- `src/components/report/ScoringTab.tsx:39-115` — ScoreRing, LevelBadge, headline, `LevelLadder`, `ScoreWaterfall`, `PosturePanel`, trend, strengths/risks.
- `src/components/report/DimensionDetail.tsx:13-78` (summary + **evidence list `:44-56`** + gaps + sparkline), `:80-126` (**`ProvenanceTrack` — band drawn from the constant `LLM_GUARDBAND` at `:92-93`**).
- `src/components/report/ReportNotices.tsx:4-19` (warnings), `:22-41` (**`ReportDiscrepancies`**).
- `src/components/report/roadmapPieces.tsx:69-104` (`TrustLadder`), `:106-118` (`PayoffChip`), `:120-138` (`NextLevelPath` — "Fastest path"), `:140-184` (`RoadmapSteps` — numbered, sorted).
- `src/components/report/roadmapPriority.tsx:13-22` — `priorityScore`, `isQuickWin`; `src/lib/scoring/impact.ts:9` — `IMPACT_RANK`.
- `src/components/report/ReportHeader.tsx:58-188` — chips (archetype/engine/AI-estimate/confidence), `FreshnessControl`, **Export PDF `:146-157`**, **Share card `:161-167`**, **Copy for LLM `:170-174`**, **SkillDownload `:177-180`**, `FoundationPrButton :183`. **No badge control.**
- `src/components/report/FreshnessControl.tsx:36-80` — "Scanned Xm ago · Re-test", `retestHref` `:45`.
- `src/components/report/ReportClientStatus.tsx:27-34` (`SCAN_STEPS`), `:37-51` (**`scoreLabel` switch**), `:53-57`, `:68-74` (`progressHeadline`), `:78-91` (`useElapsed`), `:100-107` (`displayProgressPct`).
- `src/components/report/ReportConversionCta.tsx` (whole) — the foot-of-report CTA (org scan / track repo). No badge, no permalink.

**Badge surface**
- `src/app/badge/page.tsx:1-40` — `/badge`; **no `searchParams`**.
- `src/components/badge/BadgeGenerator.tsx:20-27,79,94,132-139,237,240` — repo comes from a **typed input**, never a URL param.
- Reachability of `/badge` from anywhere: `src/components/SiteFooterCore.tsx:19`, `src/components/leaderboard/RegisterPager.tsx:46`, `src/components/landing/prototypes/index/IndexGallery.tsx:124`, `src/app/sitemap.ts:32` — **and nowhere in `src/components/report/**`**.

**Persistence**
- `src/lib/db/scans-persist.ts:69-73` (**`if (!isDbConfigured()) return null`**), `:92-97` (private-repo refusal), `:104-152` (org/repo upsert), `:154-159` (head-pointer recency guard).
- `src/lib/db/client.ts:572-574` — `isDbConfigured()` = `DATABASE_URL || DSQL_ENDPOINT`.
- `src/lib/ui.ts:42` — `reportPermalink`. Callers: `src/app/api/scan/stream/route.ts:342` (email only), trends/launch/org/live/register/practice-artifact/scan-alerts/pr-gate — **no live-report-page caller**.

**Config / env**
- `src/lib/llm/config.ts:107-110` — `techStackPromptEnabled()` reads `TECH_STACK_PROMPT`.
- `.env.local` (read for env facts only) — `LLM_PROVIDER=claude-cli`, `DATABASE_URL` set (PGlite), `ASCENT_AUTH_BYPASS=1`, `PUBLIC_SCAN_QUOTA_DISABLED=1`; **`TECH_STACK_PROMPT` is absent ⇒ flag OFF**.
- `src/lib/llm/index.ts:67,106-108,147-148` — `PROVIDER_CHOICES` includes `openai` and `openrouter`.

**Live evidence (L2-grade, arriving early — labelled at every use)**
- `uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json` — real `/api/scan` response for `vercel/swr`, 193 s, `engine.provider: "claude-cli"`, `model: "sonnet"`, `confidence 0.85`, `overallScore 47`, `level L3`, 9 dimensions with `signalScore`/`llmScore`/`score`, 5 roadmap items, 2 discrepancies, `scoreIntegrity {widenedDims:["D3"], effectiveBlend:0.51}`, passport.

---

## Surface model

```
/  (page.tsx:63)
└─ IndexLanding → ScanModal  ["Scan a repository →"  ·  ?scan=1 deep-link]   ScanModal.tsx:153,58
   └─ ScanForm                                                               ScanForm.tsx:145-287
      affordances: [input owner/repo · Scan button · Try/Top-scored chips ×3
                    · collapsible branch+sub-path scope · notify toggle (signed-in only)]
      inputs:      pasted URL is normalized in place (:164-180); /tree/<ref> prefills branch (:33-37)
      validation:  client-side normalizeRepo + validateScope, shake + role="alert" (:113-133,229-233)
      nav:         router.push(`/report?repo=…`)                              ScanForm.tsx:142

/report?repo=owner/repo                                                       app/report/page.tsx:13
└─ ReportClient                                                               ReportClient.tsx:12
   └─ useReportScan                                                           useReportScan.ts:76
      1. peek   GET /api/scan?peek=1&recent=1   → 200 ⇒ instant hydrate       :151-166
      2. stream POST /api/scan/stream           → SSE                          :174
         events: progress{stage,message,pct,provider} · result{ScanReport} · error · notify
         6-stage checklist, provider-aware, elapsed clock, monotonic bar       ReportClientStatus.tsx:27-107
         client backstop re-pinned per provider (claude-cli ≈ 12 min ceiling)  useReportScan.ts:98-116
      3. done  → <ReportView/>                   URL STAYS /report?repo=…      ReportClient.tsx:85
   server side: scanRepository → buildScanScoreInput → buildAssessmentPrompt → provider
                → engine.blend(±guardband, effectiveBlend) → ScanReport
                → cacheAndPersistScan (skipped on degrade/lowCoverage/partialPr/scoped)

/report/[owner]/[repo][@sha]   (the PERMALINK — server-rendered, never reached by the scan flow)
├─ pinned report found  → ReportView + PassportCard + SkillHistorySection      page.tsx:150-176
└─ nothing persisted    → ColdScanGate  ["Scan <repo> now" + honest terms]     ColdScanGate.tsx:43-69

ReportView                                                                    ReportView.tsx:210
├─ ReportHeader   chips[archetype · engine:claude-cli·sonnet · AI-estimate · confidence 85%]
│                 FreshnessControl(Re-test) · Export PDF · Share card · Copy for LLM · SkillDownload
├─ PassportHero (live scan carries report.passport)
├─ ReportWarnings
├─ SideNav ── Scoring | Dimensions | Roadmap | Sandbox | Contributors   (?tab= URL-backed)
│   ├─ Scoring:     ScoreRing · LevelBadge · headline · LevelLadder · ScoreWaterfall
│   │               · PosturePanel(adoption×rigor) · TrendChart · Strengths/Risks
│   ├─ Dimensions:  RadarChart + bars + DimensionDetail{summary, EVIDENCE[], gaps, sparkline,
│   │                                                    ProvenanceTrack(signal→llm→blended)}
│   ├─ Roadmap:     TrustLadder · NextLevelPath("Fastest path") · RoadmapSteps (numbered,
│   │               quick-wins-first, ExploreList, ExemplarPointer, PayoffChip)
│   ├─ Sandbox:     RoadmapSandbox (client-side what-if)
│   └─ Contributors (gated on real activity)
├─ ReportDiscrepancies  "Flagged for review"
├─ ReportConversionCta  → /onboarding (scan your org) · /connect
└─ "← Scan another repo" → /?scan=1
```

**The one structural asymmetry worth naming up front:** the scan flow terminates at `/report?repo=…`, and the permalink `/report/{owner}/{repo}@{sha}` — the artifact everything else in the product links to (`reportPermalink`, 20+ call sites) — is never surfaced to the person who just paid three minutes for the scan.

---

## Grounding score — Surface A (repo scan scoring + its roadmap field)

**`TECH_STACK_PROMPT` is unset in `.env.local` ⇒ source #7 is out ⇒ the denominator is 11.**

**Score: 10/11 wired · 9/11 effective on Sam's anonymous path.**

| # | Source (env.md §grounding, verbatim) | State | Evidence |
|---|---|---|---|
| 1 | Rubric — 5 levels + 9 weighted dimensions + criteria | **present** | `prompt.ts:85-94`, composed into SYSTEM `:180-184` |
| 2 | Task/output contract + auditor role | **present** | `prompt.ts:138-173`, `:81-83` |
| 3 | Repo metadata — owner/name, language, stars, pushedAt, description | **present** | `prompt.ts:230-232` |
| 4 | Archetype solo/team/org | **present** | `prompt.ts:233`; `scan-score-input.ts:79` |
| 5 | Standing org decisions + rationale | **wired, INERT for Sam** | `prompt.ts:125-132,234`; gated on `decisionSlug` `scan-score-input.ts:96-98`, which is only set when `orgSlug==="public" && viewer` (`stream/route.ts:235`). A truly anonymous visitor has no viewer ⇒ `orgDecisions = []` ⇒ block never renders. **Counts 0 on Sam's path.** |
| 6 | Stack-fit caveat (ML/notebook · mobile · embedded) | **present** | `prompt.ts:234`; `scan-score-input.ts:84`. Correctly `null` for `vercel/swr` (TS library) — wired and inapplicable, not missing. |
| 7 | Detected tech stack | **EXCLUDED — flag off** | `scan-score-input.ts:118`; `llm/config.ts:107-110`; `TECH_STACK_PROMPT` absent from `.env.local`. Denominator drops to 11 per env.md. |
| 8 | Deterministic per-dimension signal scores + evidence labels | **present** | `prompt.ts:192-199,236` |
| 9 | PR stats — merge/reviewed/AI-involved rates, velocity | **present** | `prompt.ts:32-45,239`. Live swr scan carried `18 merged · 56% reviewed · 17.6h TTFR` ⇒ the server's `GITHUB_TOKEN` reaches the anonymous funnel. *(L2-grade evidence.)* |
| 10 | Branch governance — protection, approvals, checks, CODEOWNERS, signatures | **present** | `prompt.ts:46-53,239`. Live scan: "1 approval(s) + code owners", "signed commits". |
| 11 | Security D9 check battery — graded checks, risk, exposure | **present** | `prompt.ts:63-73,242`; battery computed at `scan-score-input.ts:73` and **replaces** the D9 signal `:74-78`. |
| 12 | Untrusted repo evidence — commit sample + sampled file excerpts | **present but HARD-CAPPED** | `prompt.ts:216-225,245-251`; `PER_FILE=2200`, `OUTER=22000` with a `break` `:210-211,219`; commits `.slice(0,15)`×120 chars (`scan-score-input.ts:104`, `prompt.ts:224`). Ingestion pulls `MAX_TOTAL_BYTES=280_000` ⇒ **~7.9 % of what was fetched reaches the model**; the rest serves detectors only. |

### Named additions (Sam-specific — recorded, denominator UNCHANGED)

- **+ prior scans of this repo / score history** — absent. Sam's whole framing is "does the read match mine"; the model has never seen the repo's own trajectory, so it cannot say "this got worse". (env.md already lists as known-absent; naming it because it is *Sam's* biggest one.)
- **+ full file-tree manifest** — absent. The model sees ~22 KB of excerpts and no map of what it *didn't* see, so it can't calibrate its own blind spots. Directly implicated in the live D9 discrepancy (it flagged a check it inferred from one workflow file).
- **+ the assertion-substance sample** — **present**, and it is the single best-aimed grounding source for this Character: `analyze/index.ts:329-336` docks **−15** for "Sampled tests assert nothing … counting files, not behavior". This is Sam's exact scar tissue, in code. It reaches the prompt inside source #8.
- **+ CI gate advisory-vs-blocking distinction** — partially absent. `prompt.ts:380-386` (via `analyze/index.ts`) credits "CI runs tests"/"CI runs linting" but nothing distinguishes an *advisory* check from a *merge-blocking* one except the branch-protection block (#10). The live scan's own D2 gap line concedes it: "No explicit coverage-threshold gate confirmed."

---

## Reachability set

Sam is **anonymous, no login, public repo, no org**. Host facts: `ASCENT_AUTH_BYPASS=1`, `DATABASE_URL` set (PGlite), `LLM_PROVIDER=claude-cli`, `PUBLIC_SCAN_QUOTA_DISABLED=1`.

**Reachable and in-journey:** `/` + the scan modal · `/report?repo=…` (full live scan, all 5 tabs) · `/report/{owner}/{repo}[@sha]` (typed by hand, or via ColdScanGate) · `/about` (from "How scoring works") · `/badge` (footer only) · PDF / Share-card / Copy-for-LLM / SkillDownload from the report header · `/onboarding`, `/connect` from the foot CTA.

**Reachable but out of journey scope** (`journeys/…:22-27`): `/report/compare`, `/trends`, all `/org/*`, billing.

**Not reachable for Sam — tagged `unreachable`:**
- `FoundationPrButton` — needs `installFoundation`, i.e. org member of a non-public repo (`page.tsx:148`). Never renders for him.
- Passport edit controls — `canEditPassport` requires org owner (`page.tsx:144`).
- `NotifyToggle` — signed-out ⇒ hidden (`ScanForm.tsx:244-250`).
- The **quota banner / blocked wall** — `PUBLIC_SCAN_QUOTA_DISABLED=1` on this host. A real anonymous user on the hosted product hits a 5-scan/month wall. **L2 precondition, cannot be exercised here.**
- `openai` / `openrouter` progress labels — unreachable under `LLM_PROVIDER=claude-cli`.

**Where DB-on vs DB-off diverges (recurrence lead #3) — traced:**

| | `DATABASE_URL` set (this host, and hosted prod) | `DATABASE_URL` unset |
|---|---|---|
| `persistScanReport` | writes org/repo/scan rows | **returns `null` immediately** (`scans-persist.ts:73`) |
| reload of `/report?repo=X` | peek `recent=1` hits the DB tier ⇒ **instant re-hydrate**, no re-scan | peek hits only the per-process memory cache; cold instance ⇒ **full multi-minute re-scan** |
| `/report/{owner}/{repo}` typed later | renders the pinned report | `ColdScanGate` — "No report yet" |
| `SkillDownload` / `Export PDF` | 200 (both read `getScanReportByCommit`) | **404** — `skill/route.ts` explicitly "404 when the repo has no saved scan" |

**So the "public-funnel scan forgotten on reload" recurrence is materially closed on the DB path** — the commit-SHA dedup and mock→live upgrade in `scans-persist` do work, and `improvement.ts:513`'s "scan row may never exist" comment is stale for this flow. What has **not** closed is the *user-visible* half: nothing tells Sam a permalink exists or hands it to him (SAM-L1-04). That is the narrowed survivor, at `recurrence: 2`.

---

## Walkthrough (in character, cognitive-walkthrough questions per step)

**Step 1 — landing → find where to paste.**
Q1 know what to do? Yes. Q2 see the control? Yes — "Scan a repository →" (`ScanModal.tsx:153`). Q3 connect control to intent? Yes; the label is the verb. Q4 understand what happened? Yes — a modal with a `github.com/` prefix and an `owner/repo` placeholder (`ScanForm.tsx:158,185`).
*Sam:* one extra click versus an inline hero field. Not a finding. The `github.com/` prefix is the right kind of honesty — it tells me the input grammar without a tooltip. Pasting a full URL collapses it in place (`:164-180`), and a `/tree/<branch>` link prefills the branch field (`:33-37`). Somebody who actually pastes GitHub links wrote this.

**Step 2 — submit.**
Client validates before navigating (`:113-133`), shakes, and announces via `role="alert"`. No round-trip to be told I typo'd. Fine.

**Step 3 — the wait.** *This is the pet-peeve checkpoint: "latency theater: a spinner with no streamed progress."*
Q4 understand what happened? **Yes, emphatically.** Six named stages (`ReportClientStatus.tsx:27-34`), the score step labelled by the **resolved provider** — "Asking Claude" for `claude-cli` (`:37-51`) — an elapsed clock (`:78-91`), and a bar that blends the server's stage pct with a provider-calibrated time curve via `max()` so it only moves forward (`:100-107`). The server keeps the socket warm with a 15 s ping (`stream/route.ts:147-153`) and the client backstop re-pins to whichever provider the stream names (`useReportScan.ts:98-116`). If the model fails over, the label says so (`:57`).
*Sam:* that is not latency theater. That's the first honest progress bar I've seen on an LLM product. Live measurement: **193 s** on `vercel/swr` *(L2-grade)*. Three minutes with real stage names beats ninety seconds of a spinner.

**Step 4 — the score.**
Scoring tab: ring, level badge, headline, ladder, **ScoreWaterfall** (headline attributed per dimension), posture quadrant, strengths/risks. Header chips: `engine: claude-cli · sonnet`, `AI estimate · may vary between runs`, `confidence 85%` — each with a hover + sr-only explanation (`ReportHeader.tsx:122-139`).
Q3 connect to my mental model? Yes. Q1 know what to do next? Yes — SideNav names the sections.
*Sam:* "AI estimate · may vary between runs" is a chip most products would never ship. Noted.

**Step 5 — re-trace a score. The whole visit turns here.**
I open Dimensions, click D2 (98/100 — the number I'd challenge first, because I've been burned by exactly this). I get: summary, an **Evidence** list, gaps, and a **ProvenanceTrack** showing signal → LLM → blended with a shaded guardband (`DimensionDetail.tsx:44-56,75,86-125`).

The provenance track is the right idea and I'd have built it. The evidence list is where it breaks. Live evidence, D2 *(L2-grade)*:

```
- Found 138 test files
- Test framework configured
- End-to-end tests configured
- Coverage tracking configured
- High test-to-source ratio (1.04)
```

Where's this coming from? Which 138 files? Which framework, declared where? The `Signal` type has a `detail` field for exactly this (`types.ts:326-331`) — and across all of `analyze/index.ts` it is populated **once**, on the *failure* placeholder (`:844`). `s.add(22, "Found CLAUDE.md")` at `:190` matched a regex against the index and threw the matched path away. **This is the one criterion Sam cannot compromise on, and it fails.** → SAM-L1-01.

Then the track itself. The band is drawn from the module constant `LLM_GUARDBAND` (`DimensionDetail.tsx:92-93`) — but the engine doubles it to ±50 for any dimension a discrepancy widened (`engine.ts:205`), and blends with `effectiveBlend = SCORE_BLEND × coverage` (`:153,211`), neither of which the UI shows. `scoreIntegrity` — which records exactly this — is computed (`engine.ts:339-346`), typed (`types.ts:631`), persisted, and **rendered by nothing**: `grep -rn scoreIntegrity src --include=*.tsx` returns zero component hits. → SAM-L1-02.

I re-derived the blend to check whether the picture is at least *arithmetically* honest (execute, don't eyeball — reproduction below): every one of the nine dimensions reconstructs exactly from `round(0.51·clamp(llm, signal±band) + 0.49·signal)`. So the machinery is sound and auditable — **if you are handed 0.51 and the band.** The UI hands you neither, and a reader assuming the obvious 50/50 at ±25 gets D2 wrong by a point.

**Step 6 — the discrepancies.**
"Flagged for review" renders both live claims (`ReportNotices.tsx:22-41`). The D9 claim is a genuinely sharp catch — the auditor read `trigger-release.yml`, saw `permissions: id-token: write` + npm ≥ 11.5.1, and argued the "Signed releases 0/10" check missed OIDC trusted-publishing provenance. *That is a better catch than I'd have made on a first pass.*
But the panel says only "may be wrong — worth verifying". It doesn't say that D9 is **deterministic** and therefore structurally ineligible for widening (`engine.ts:105-110`, `scan-score-input.ts:74-78`), so that claim moved nothing; and it doesn't say D3's band was doubled because of the other one. `scoreIntegrity.widenedDims: ["D3"]` knows. The screen doesn't. → SAM-L1-06.

**Step 7 — the roadmap.**
Five items, sorted quick-wins-first (`roadmapPriority.tsx:13-19`), numbered, each with impact/effort chips, an axis chip, a projected-payoff chip (`roadmapPieces.tsx:106-118`), an "Explore" question set, a "What good looks like" practice pointer, plus a **Fastest path** projection above the list (`:120-138`). Reproduced ordering *(L2-grade input, deterministic function)*: #1 D1 (29, quick win), #2 D4 (28, quick win), #3 D9 (28, quick win), #4 D6 (19), #5 D8 (18).

Content check against my bar — "not 'add more tests'":
- "0 of 8 Action references are pinned to a SHA, there's no committed Dependabot/Renovate config, and no SAST tool runs in CI"
- "only 56% of sampled merged PRs carry an approving review" despite a rule requiring 1 approval + code-owner review — "likely maintainer self-merges or an admin bypass"
- "Would surfacing the commands already used in CI (`pnpm run-all-checks`, `pnpm test-typing`, `pnpm test:e2e`) into a lightweight CLAUDE.md be enough to start?"

That is repo-specific and it is *right*. Better than "improve documentation" by a mile. The friction is structural, not factual: the prompt **forbids imperatives** — titles must be observations, actions must be open questions (`prompt.ts:144-153`) — so the ticket I'd actually file ("pin the 8 Action refs to SHAs") exists only inside a rationale paragraph and a question. I have to do the extraction. → SAM-L1-05.

**Step 8 — the badge.** *Sam's JTBD #3, verbatim: "Hand me a badge and a level I'd stake my name on in the README."*
I look in the header: PDF, Share card, Copy for LLM, SKILL.md. No badge. Foot of report: "Scan your org" / "Track this repo" / "Scan another repo". No badge. `grep` across `src/components/report/**` for `/badge`: **zero hits**. The only routes to `/badge` are the site footer, the leaderboard pager, and a landing gallery. And when I get there by footer, `/badge` reads **no `?repo=`** (`app/badge/page.tsx` has no `searchParams`; `BadgeGenerator.tsx` sources the repo from a typed input at `:132-139`) — so I retype the repo I just scanned. → SAM-L1-03. **Criterion 6 fails on reachability, before I ever get to judge whether the level is inflated.**

**Step 9 — leave and come back.**
My address bar still reads `/report?repo=vercel/swr`. Nothing on the page ever showed me `/report/vercel/swr@<sha>`, which is the URL every other surface in this product links to (`reportPermalink`, 20+ call sites — none of them this page). With the DB on, a reload does re-hydrate instantly from the peek, so I don't lose the work. But the thing I'd paste into Slack, I was never given. → SAM-L1-04, `recurrence: 2` at narrowed scope.

---

## Reproductions (execute, don't eyeball)

**R1 — the blend formula is exactly reconstructible; the UI withholds one of its two inputs.**
```
$ node -e "...blend check over _l2-warm-scan-swr.json..."
effectiveBlend 0.51  coverage 0.85  => SCORE_BLEND 0.6000
D1 actual 3  | model(eb, band25) 3  MATCH | naive 50/50 ±25 -> 3
D2 actual 98 | model(eb, band25) 98 MATCH | naive 50/50 ±25 -> 99   <-- diverges
D3 actual 76 | model(eb, band50) 76 MATCH | naive 50/50 ±25 -> 76
D4..D9       | all MATCH
```
Formula confirmed as `engine.ts:211`, band per `:205`, `effectiveBlend` per `:153`, `SCORE_BLEND=0.6` (`model.ts:50`), `LLM_GUARDBAND=25` (`:57`). D3 is the widened dimension (`scoreIntegrity.widenedDims: ["D3"]`) and the drawn band is wrong for it — though on this scan the LLM sat inside ±25 anyway, so the *visible story* doesn't change. That is luck, not design.

**R2 — `Signal.detail` is effectively unused by the file detectors.**
```
$ grep -c "label:"  src/lib/analyze/index.ts   -> 25
$ grep -c "detail:" src/lib/analyze/index.ts   -> 1     (line 844 — the detector-failure placeholder)
```
Contrast `analyze/pulls.ts`, which populates `detail` five times (`:214,229,243,267,271`) — which is exactly why the D6/D9 evidence lines in the live report *do* carry substance ("PR review coverage 56% (18 merged · 70% small · 0% reverted)") while every file-derived line does not.

**R3 — roadmap ordering.** `priorityScore = IMPACT_RANK×10 − EFFORT_RANK` reproduced above; quick-win predicate `impact==="high" && effort!=="high"` marks items 1–3.

**R4 — no badge path from the report.** `grep -rn '"/badge\|href={`/badge\|/badge?' src --include=*.tsx` → 4 hits, none under `src/components/report/`. `/badge` reads no `searchParams`.

---

## Shared-mapping branch enumeration (convergence is not coverage)

SAM-L1-08 lands inside `scoreLabel` (`ReportClientStatus.tsx:37-51`), a switch over `ProviderName`. `ProviderName` has **six** members (`types.ts:8`) and `PROVIDER_CHOICES` confirms all six are selectable (`llm/index.ts:67,106-108,147-148`). Every branch, audited:

| Branch | Label | Verdict |
|---|---|---|
| `gemini` | "Asking Gemini" | **clean** |
| `claude-cli` | "Asking Claude" | **clean** — Sam's path |
| `bedrock` | "Querying Bedrock in {region ?? us-east-1}" | **clean** (region-aware) |
| `mock` | "Running deterministic rubric" | **clean** |
| `openai` | *falls to `default`* → "Scoring against the rubric" | **uncovered** |
| `openrouter` | *falls to `default`* → "Scoring against the rubric" | **uncovered** |
| `undefined` (pre-first-frame) | "Scoring against the rubric" | **clean — correct** |

Two of six providers lose the provider-honesty the other four get, during the single longest wait in the product. Not reachable on this host (`LLM_PROVIDER=claude-cli`) ⇒ `reachable: false`, `polish`.

Second shared mapping touched, audited and **clean throughout**: `classifyScanResult` (`scan-finalize.ts:104-110`) → `willPersist` (`stream/route.ts:292`). All four guards (`degradedToMock`, `lowCoverage`, `partialPrSlice`, `scoped`) suppress persist **and** the completion email consistently; the refund fires on cached-hit (`:212`), joiner (`:279`), degrade (`:296`) and throw (`:356`). No finding.

---

## Scored acceptance criteria (judged identically every run)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Overall level + 9 dimension scores + posture quadrant **reconcile** with each other and with the repo | **PASS** | Blend reproduced exactly on all 9 dims (R1). `overallScoreFor` is a renormalized weighted *mean* that excludes dropped dims (`engine.ts:274-280`); axis roll-up uses the same present-predicate (`:283-291`); an unmeasured axis raises an explicit warning rather than silently mis-quadranting (`:299-308`). The live swr read — deep tests, gated CI, near-zero AI-native tooling → low L3 — matches what I'd say about that repo. |
| 2 | **Every dimension score cites concrete, re-traceable evidence** (file:line / PR / commit / governance fact) | **FAIL** | File-derived evidence is bare labels; `Signal.detail` used once in `analyze/index.ts` and only for a failure (R2). D6/D9 pass (`pulls.ts`, security battery); D1–D5, D7, D8 do not. Sam's automatic-trust-failure clause. → SAM-L1-01 |
| 3 | **LLM-vs-detector discrepancies surfaced, not hidden** | **PASS (partial)** | `ReportDiscrepancies` renders every claim (`ReportNotices.tsx:22-41`); the live run showed two, one genuinely sharp. But the *outcome* of each flag (widened / ineligible / budget-capped) is computed and never shown. → SAM-L1-06 |
| 4 | Roadmap names a **specific, evidence-grounded, highest-leverage next move** | **PASS (with friction)** | Ordered quick-wins-first (R3), "Fastest path" projection, payoff chips, and content citing 8 unpinned Actions / 56% review rate / this repo's own `pnpm` script names. Nowhere near "add more tests". The specific move is buried in a rationale paragraph by the invitational-voice mandate. → SAM-L1-05 |
| 5 | Credible, defensible verdict in **~2–3 minutes** vs a day's manual audit | **PASS (conditional — L2 to confirm)** | Live scan **193 s** *(L2-grade)*; add ~3–4 min to read Scoring + Dimensions + Roadmap ⇒ ~7 min. Over the literal 2–3 min bar, vastly under the day. The progress UX makes the wait legible, which is what the criterion was really guarding. |
| 6 | **Badge / level Sam would stake his name on** in a public README | **FAIL** | Not on reachability, not on quality: there is **no badge affordance anywhere on the report** and `/badge` won't accept the repo he just scanned (R4). He cannot get to the object the criterion judges. → SAM-L1-03 |
| 7 | Generated artifacts (`.ai/` standard, onboarding SKILL.md) are **repo-specific and accurate** | **PASS (structural, L2 must confirm content)** | `SkillDownload` posts the pinned `owner/name@sha` (`ReportHeader.tsx:177-180`); `/api/report/skill` builds from the **persisted report's own tracks** and 404s without one (`skill/route.ts:1-14,20`), with a maintainer `?dims=` selection. Structurally this repo's data, not a template. Whether the prose is repo-specific is an L2 question. |

**4 pass · 2 conditional-pass · 2 fail (criteria 2 and 6).**

---

## Time-saved

Sam's declared baseline, **verbatim** from `uat/characters/sam-staff-engineer.md:40`:

> "The traditional way: Sam blocks out the better part of a working day to audit a repo's engineering maturity — clone it, read the CI config and the test suite for *real* assertions, grep for conventions/eval-harness files, eyeball commit and PR hygiene, sanity-check dependency pinning and the supply chain, then hand-write a prioritized improvement plan. Hours, and it's exactly the kind of tedious read senior engineers resent because (per the code-health literature) it burns the mental capacity they should spend on hard problems. Ascent has to compress that day into a couple of minutes *and* match the quality of what Sam would have produced. If it's slower than a sharp grep session, or barely faster but shallower, Sam won't adopt it — that's a finding."

Senior-quality bar, **verbatim** (`:43`):

> "The score + roadmap + generated artifacts must be at least as good as Sam's own staff-engineer read of the repo. A score that contradicts the repo's actual state fails. A roadmap that ignores the cited evidence, or lands on 'add more tests / improve CI,' fails — Sam would write something sharper in five minutes. The generated `.ai/` standard and onboarding SKILL.md must reflect *this* repo's real conventions (its actual test runner, its actual CI gates, its actual AGENTS.md), not a generic template Sam could have downloaded. If Sam would reject the output in code review, it fails even if the flow 'worked.'"

**Estimated time-saved if it all worked: ~5 h 50 min per repo · confidence medium.**
Manual baseline ≈ 6 h ("the better part of a working day"). Designed flow ≈ 3 min scan (193 s measured, L2-grade) + ~4 min reading ≈ 7 min.
**Deduct ~20–30 min per repo for what does *not* work today:** with no file paths on the evidence lines, Sam re-greps the repo to confirm the dimensions he intends to defend upward — which is precisely the tedium the product exists to remove. Net realized ≈ **5 h 20 min**, and the gap between 5 h 20 and 5 h 50 is entirely SAM-L1-01.

---

## Findings

```json
[
  {
    "id": "SAM-L1-01",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Per-dimension evidence lines are unsourced labels — the file detectors never emit the path they matched, though Signal.detail exists for exactly that",
    "expected": "Every dimension score cites concrete, re-traceable evidence — file:line / PR / commit / governance fact — so a skeptic can re-check it himself. Sam's scored criterion #2, and his stated automatic trust failure: 'Unsourced claims: a dimension score with no file:line, no PR, no commit behind it. Where's this coming from?'",
    "got": "File-derived evidence renders as bare labels: 'Found 138 test files', 'Test framework configured', 'GitHub Actions CI present', 'Formatter configured'. The `Signal` type carries an optional `detail` for 'path, count, etc.' (types.ts:326-331) and `Scorer.add/note` both accept it (analyze/index.ts:93-99), but across all of analyze/index.ts it is populated exactly ONCE — on the detector-FAILURE placeholder at :844. The detectors match by regex against the repo index (`idx.has(/(^|\\/)claude\\.md$/)` at :190) and discard the matched path. Only pulls.ts (D6/D7 PR + governance) and the D9 security battery produce substantive evidence strings.",
    "evidence": [
      "src/lib/analyze/index.ts:190-211 — D1 detectors: `s.add(22, \"Found CLAUDE.md (Claude Code guidance)\")`, no path",
      "src/lib/analyze/index.ts:252-299 — D2 detectors: `s.add(base, `Found ${n} test file${…}`)`, no paths",
      "src/lib/analyze/index.ts:363-386 — D3 detectors: 'GitHub Actions CI present', 'CI runs tests', no workflow filename",
      "src/lib/types.ts:326-337 — `Signal { label; detail?: /* path, count, etc. */ }` + formatSignal",
      "src/lib/analyze/index.ts:844 — the ONLY `detail:` in the file, and it is the failure placeholder",
      "src/lib/analyze/pulls.ts:214,229,243,267,271 — the contrast: five populated details, which is why D6/D9 evidence reads substantively",
      "src/components/report/DimensionDetail.tsx:44-56 — the render site; it prints whatever formatSignal produced, nothing more",
      "reproduction: `grep -c 'label:' src/lib/analyze/index.ts` -> 25 ; `grep -c 'detail:'` -> 1",
      "uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json — live D2 evidence array, all five entries pathless (L2-grade evidence)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Open the Dimensions tab on a live claude-cli scan and read D1/D2/D3/D5/D8 evidence lists in the rendered DOM; confirm no path/line appears and that no tooltip or expander reveals one. PRECONDITION: LLM_PROVIDER=claude-cli (or mock — the detector layer is provider-independent, so this reproduces on either), DATABASE_URL either, anonymous viewer, GITHUB_TOKEN present (absent only removes D6/D9, which are the two that PASS).",
    "reachable": true
  },
  {
    "id": "SAM-L1-02",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The provenance track hides both of its own parameters: it draws a fixed ±25 band even where the engine used ±50, and never shows the blend weight — while scoreIntegrity, which records exactly this, is rendered by nothing",
    "expected": "The signal→LLM→blended provenance track is the affordance that converts Sam. To re-trace a score he needs the two numbers that produce it: the guardband actually applied to THAT dimension, and the blend weight. Where a discrepancy doubled the band, the picture must say so.",
    "got": "ProvenanceTrack computes its shaded zone from the module constant LLM_GUARDBAND (=25) unconditionally (DimensionDetail.tsx:92-93). The engine uses `band = widenedDims.has(id) ? LLM_GUARDBAND * 2 : LLM_GUARDBAND` (engine.ts:205) and blends `round(effectiveBlend*guarded + (1-effectiveBlend)*signal)` where `effectiveBlend = SCORE_BLEND * coverage` (engine.ts:153,211). Neither the widening nor the weight reaches the screen. `scoreIntegrity {widenedDims, widenCapped?, effectiveBlend}` is built at engine.ts:339-346, typed at types.ts:631, persisted — and `grep -rn scoreIntegrity src --include=*.tsx` returns ZERO component hits. In the live swr scan D3 was widened to ±50 and effectiveBlend was 0.51, and the UI would draw ±25 and imply nothing about the weight.",
    "evidence": [
      "src/components/report/DimensionDetail.tsx:92-93 — `bandLo/bandHi` from the constant LLM_GUARDBAND, no per-dimension input",
      "src/lib/scoring/engine.ts:205 — `const band = widenedDims.has(s.id) ? LLM_GUARDBAND * 2 : LLM_GUARDBAND`",
      "src/lib/scoring/engine.ts:153,211 — effectiveBlend = SCORE_BLEND * coverage; the blend expression",
      "src/lib/maturity/model.ts:50,57 — SCORE_BLEND = 0.6, LLM_GUARDBAND = 25",
      "src/lib/scoring/engine.ts:339-346 — scoreIntegrity assembled (widenedDims, widenCapped, effectiveBlend)",
      "src/lib/types.ts:631 — `scoreIntegrity?: ScoreIntegrity` on ScanReport",
      "grep -rn 'scoreIntegrity' src --include=*.tsx --include=*.ts | grep -v test -> only engine.ts:339 and types.ts:631 — no renderer",
      "reproduction R1: all 9 live dimensions reconstruct from round(0.51*clamp(llm, signal±band) + 0.49*signal); a naive 50/50-at-±25 reading gets D2 wrong (99 vs 98). effectiveBlend/coverage = 0.51/0.85 = 0.6000 = SCORE_BLEND exactly",
      "uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json — scoreIntegrity: {widenedDims:['D3'], effectiveBlend:0.51} (L2-grade evidence)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "scope_note": "The arithmetic is honest and fully reproducible — this is a disclosure gap in the audit surface, not a wrong number. Ranked on trust_erosion because the provenance track is the single affordance this Character's adoption turns on.",
    "l2_priority": "On a live scan whose scoreIntegrity.widenedDims is non-empty, hover/inspect that dimension's ProvenanceTrack and confirm the SVG band width corresponds to ±25 rather than ±50, and that no surface anywhere shows effectiveBlend or the widening. PRECONDITION: LLM_PROVIDER=claude-cli (mock produces no discrepancies at all, so widenedDims is always empty and this is NOT reproducible on the mock path), anonymous, GITHUB_TOKEN present.",
    "reachable": true
  },
  {
    "id": "SAM-L1-03",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No badge affordance anywhere on the report, and /badge won't accept the repo just scanned — one of Sam's three jobs-to-be-done has no path through the product",
    "expected": "Sam's JTBD #3 verbatim: 'Hand me a badge and a level I'd stake my name on in the README without getting roasted in the next standup.' Scored criterion #6. The report is the moment he'd do it, and the badge generator already exists and already emits Markdown/HTML/AsciiDoc plus CI-gate snippets.",
    "got": "src/components/report/** contains ZERO references to /badge. The report header offers Export PDF, Share card (PNG), Copy for LLM, SKILL.md — no badge snippet. The foot CTA offers 'Scan your org' / 'Track this repo' / 'Sign in'. The only routes to /badge in the whole app are the site footer, the leaderboard pager and a landing gallery. And /badge itself takes no searchParams (app/badge/page.tsx has no searchParams prop; BadgeGenerator sources the repo from a typed <input> at :132-139), so a visitor who finds it by footer retypes the repo he just scanned.",
    "evidence": [
      "reproduction R4: `grep -rn '\"/badge\\|href={`/badge\\|/badge?' src --include=*.tsx` -> src/app/sitemap.ts:32, src/components/landing/prototypes/index/IndexGallery.tsx:124, src/components/leaderboard/RegisterPager.tsx:46, src/components/SiteFooterCore.tsx:19 — none under src/components/report/",
      "src/components/report/ReportHeader.tsx:141-184 — the full export row: FreshnessControl, PDF, Share card, CopyForLlm, SkillDownload, FoundationPrButton",
      "src/components/report/ReportConversionCta.tsx — the foot-of-report CTA; org scan / track / sign-in only",
      "src/app/badge/page.tsx:11-40 — no searchParams parameter",
      "src/components/badge/BadgeGenerator.tsx:132-139 — repo is a typed input; no useSearchParams anywhere in the file"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "scope_note": "The badge GENERATOR is built and good (Markdown/HTML/AsciiDoc + CI gate snippets, /api/badge/[owner]/[repo] live SVG). This is purely the missing link from the report plus the missing ?repo= prefill — small work, and it unblocks a whole declared job.",
    "l2_priority": "Complete a live scan, then sweep the rendered report DOM (all five tabs + header + footer) for any control whose text or href mentions badge/README/embed. Then open /badge?repo=<the scanned repo> and confirm the field is empty. PRECONDITION: any provider, DB on or off (badge is DB-independent), anonymous viewer.",
    "reachable": true
  },
  {
    "id": "SAM-L1-04",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The scan flow ends on /report?repo=… and never surfaces the permalink — the durable artifact is written but never handed to the person who paid for it",
    "expected": "After a three-minute scan Sam has the shareable, commit-pinned URL — the thing he pastes into Slack or the PR — either in the address bar or behind an obvious copy control.",
    "got": "ScanForm pushes to /report?repo=… (ScanForm.tsx:142) and ReportClient renders the report in place with no redirect (ReportClient.tsx:85). reportPermalink() has 20+ call sites across trends, launch, org, live, register, practice-artifact, scan-alerts and pr-gate — and exactly ONE in the scan path: the completion EMAIL (stream/route.ts:342), which only fires for a signed-in opt-in. Nothing on the live-scan report links to, displays, or copies /report/{owner}/{repo}@{sha}.",
    "evidence": [
      "src/components/ScanForm.tsx:142 — `router.push(`/report?repo=…`)`",
      "src/components/report/ReportClient.tsx:85 — renders ReportView; no navigation on settle",
      "src/lib/ui.ts:42 — reportPermalink",
      "src/app/api/scan/stream/route.ts:342 — the sole scan-path caller, inside the notify-email branch",
      "grep of reportPermalink call sites: no consumer under src/components/report/ other than DimensionTrends.tsx:124,138 (history points, not this scan)",
      "src/lib/db/scans-persist.ts:69-73 — persistence is real when isDbConfigured(); the artifact exists, it is just never named to the user",
      "src/app/report/[owner]/[repo]/page.tsx:116-123 — the permalink resolves the pinned report when persisted, else ColdScanGate"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "recurrence": 2,
    "scope_note": "NARROWED from the 2026-07-16 finding 'public-funnel scan forgotten on reload'. The DATA half is closed: persistScanReport dedups per commit SHA, upgrades mock->live, and the peek (peek=1&recent=1) re-hydrates a reload instantly on the DB path — improvement.ts:513's 'a scan row may never exist' comment is stale for this flow. What returns unchanged is the DISCOVERABILITY half: the user is never given the URL. Second run, same gap.",
    "l2_priority": "Complete a live scan; record the address bar; reload; then sweep for any copy-link/permalink control. Then run the SAME scan with DATABASE_URL unset and confirm the divergence: reload re-scans, /report/{owner}/{repo} shows ColdScanGate, and SkillDownload/Export PDF 404. PRECONDITION: needs TWO arms — (a) DB ON (this host, PGlite) and (b) DB OFF, which this host cannot serve without a restart; if arm (b) is not run, resolve it `uncertain — not reproducible on this host`, never refuted. Provider: any. Anonymous viewer both arms.",
    "reachable": true
  },
  {
    "id": "SAM-L1-05",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "The roadmap's mandated invitational voice buries the concrete move inside a rationale paragraph — the specifics are there and are excellent, but Sam has to extract his own ticket",
    "expected": "Scored criterion #4: the roadmap names a specific, evidence-grounded, highest-leverage next move Sam would put in the next sprint — e.g. 'pin the 3 unpinned GitHub Actions to SHAs; gate the advisory 70% coverage check in CI'.",
    "got": "prompt.ts:144-153 mandates the opposite shape: titles must be observations not imperatives ('Agent guidance is thin', explicitly NOT 'Add a CLAUDE.md'), and the actionable field is `explore` — '2-3 invitational questions', 'open questions, not steps'. The live output honours it: title 'Supply-chain automation hasn't caught up to the project's exposure'; the actual move ('pinning the 8 GitHub Action references to SHAs') appears once inside the rationale and once as a question. The surrounding machinery is strong — numbered quick-wins-first ordering, a Fastest-path projection, payoff chips — so the ranking Sam needs IS there; only the imperative sentence is withheld by design.",
    "evidence": [
      "src/lib/scoring/prompt.ts:144-153 — 'IMPORTANT — Ascent is a transition COMPANION, not a boss … NOT an imperative … open questions, not steps … invitational throughout'",
      "src/components/report/roadmapPieces.tsx:140-184 — RoadmapSteps renders title + rationale + ExploreList + ExemplarPointer + chips",
      "src/components/report/roadmapPriority.tsx:13-19 — priorityScore + isQuickWin (the ranking that DOES land)",
      "src/components/report/roadmapPieces.tsx:120-138 — NextLevelPath 'Fastest path' projection",
      "reproduction R3: ordering resolves to D1(29,QW) > D4(28,QW) = D9(28,QW) > D6(19) > D8(18)",
      "uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json — roadmap[2].rationale contains '0 of 8 Action references are pinned to a SHA'; roadmap[2].explore[0] asks whether pinning them would be a first move (L2-grade evidence)"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "scope_note": "This is a deliberate product-voice decision (documented in the prompt itself), not a defect — recorded because it costs THIS Character time on every run and is the one place where the product's stated philosophy and a staff engineer's scored bar pull against each other. A per-item 'concrete first step' field would satisfy both without abandoning the companion framing.",
    "l2_priority": "Read the live Roadmap tab and time how long it takes to extract a sprint-ready ticket from item #1. Check whether any UI element (not the model prose) states an imperative next step. PRECONDITION: LLM_PROVIDER=claude-cli — on mock the roadmap comes from buildFallbackRoadmap (engine.ts:311-315), a different code path with different phrasing, so this is NOT reproducible on the mock path.",
    "reachable": true
  },
  {
    "id": "SAM-L1-06",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "'Flagged for review' lists the auditor's claims but never says what each one did — a flag on a deterministic dimension moved nothing, and the reader can't tell that from a flag that doubled a guardband",
    "expected": "Sam can see where the model and the deterministic detector disagreed AND what the system did about it — the disagreement is only half the information; the disposition is the half that tells him whether the number in front of him was affected.",
    "got": "ReportDiscrepancies renders `{dimension} {claim}` with the blanket caption 'may be wrong — worth verifying'. The engine meanwhile makes three distinct dispositions: (a) an ELIGIBLE flag doubles that dimension's guardband to ±50; (b) a flag on a deterministic dimension (D9) or a dropped/unknown one is INELIGIBLE and widens nothing; (c) more than MAX_FLAGGED_DIMENSIONS=2 eligible flags blows the budget so NONE widen and a warning is pushed. In the live swr scan the D9 claim was case (b) and the D3 claim was case (a) — the panel presents them identically.",
    "evidence": [
      "src/components/report/ReportNotices.tsx:22-41 — the whole renderer; dimension + claim, no disposition",
      "src/lib/scoring/discrepancy-policy.ts:20,36-41 — MAX_FLAGGED_DIMENSIONS=2, all-or-nothing budget",
      "src/lib/scoring/engine.ts:105-110 — the budget is applied to ELIGIBLE dims only (deterministic/failed/unknown excluded)",
      "src/lib/scoring/engine.ts:122-125 — the capped case pushes a warning naming the count",
      "src/lib/scoring/engine.ts:205 — the payoff a widened flag buys (±25 -> ±50)",
      "src/lib/scan-score-input.ts:74-78 — D9 is flagged `deterministic`, so a D9 discrepancy can never widen anything",
      "uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json — discrepancies[0].dimension='D9' (ineligible), discrepancies[1].dimension='D3'; scoreIntegrity.widenedDims=['D3'] (L2-grade evidence)"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "scope_note": "Shares a root cause with SAM-L1-02 (scoreIntegrity has no renderer) but is a separate user-facing surface with its own copy; kept distinct so it can be fixed or declined independently.",
    "l2_priority": "On a live scan carrying >=1 discrepancy, confirm the panel shows no disposition, and cross-check the response's scoreIntegrity.widenedDims against what was rendered. PRECONDITION: LLM_PROVIDER=claude-cli — MockProvider emits no discrepancies, so the panel does not render at all on the mock path and this is NOT reproducible there.",
    "reachable": true
  },
  {
    "id": "SAM-L1-07",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "~8% of the ingested repo reaches the model, and neither the report nor the prompt tells the model (or Sam) what was left out",
    "expected": "Either the sampling is wide enough that the auditor's judgement is well-founded, or the report is explicit about what the model did not see — Sam judges an audit by what it looked at.",
    "got": "Ingestion fetches up to MAX_TOTAL_BYTES=280_000 (github/source.ts:73). The prompt caps file excerpts at PER_FILE=2200 chars and hard-`break`s the accumulator at OUTER=22000 (prompt.ts:210-211,219), and commits at 15 messages x 120 chars (scan-score-input.ts:104, prompt.ts:224). That is ~7.9% of the fetched bytes. The remainder legitimately serves the deterministic detectors — the comment at prompt.ts:206-209 says so, and 'don't align them by shrinking the fetch budget' is correct advice. But no file-tree manifest accompanies the excerpts, so the model has no map of its own blind spot, and the report's only coverage signal is the `confidence` chip (85% here), which measures fetch coverage, not prompt coverage.",
    "evidence": [
      "src/lib/scoring/prompt.ts:210-211 — PER_FILE = 2200, OUTER = 22000",
      "src/lib/scoring/prompt.ts:219 — `if (joined.length >= OUTER) break;`",
      "src/lib/scan-score-input.ts:104 — `commitSample: snapshot.commits.map(c => c.message).slice(0, 15)`",
      "src/lib/scoring/prompt.ts:224 — each commit further sliced to 120 chars",
      "src/lib/github/source.ts:73 — MAX_TOTAL_BYTES = 280_000",
      "src/components/report/ReportHeader.tsx:28-29,133-139 — CONFIDENCE_HINT describes FETCH coverage ('the share of the repository's signal-bearing files the scan could actually read'), not prompt coverage",
      "env.md §grounding names this cap explicitly as 'findings-in-waiting'"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "scope_note": "Deliberate and defensible (context economics; detectors read the full bytes). Recorded as a grounding-cap finding per env.md's instruction to cite these, and because a file-tree manifest is the cheap half of the fix — it costs a few hundred tokens and lets the auditor say 'I did not see X' instead of inferring from one workflow file, which is exactly what the live D9 discrepancy did.",
    "l2_priority": "Control arm: run the same repo twice and check whether the auditor's discrepancies/roadmap cite files that fall outside the first 22 KB of the excerpt block. PRECONDITION: LLM_PROVIDER=claude-cli, GITHUB_TOKEN present, and a repo large enough for the OUTER break to fire (vercel/swr qualifies).",
    "reachable": true
  },
  {
    "id": "SAM-L1-08",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "scoreLabel covers 4 of 6 providers — openai and openrouter scans show the generic 'Scoring against the rubric' through the longest wait in the product",
    "expected": "The provider-aware progress label — the thing that turns a three-minute wait from latency theater into a legible operation — works for every provider the app can be configured with.",
    "got": "The switch names gemini, claude-cli, bedrock and mock; ProviderName has six members and PROVIDER_CHOICES confirms openai and openrouter are selectable. Those two fall through to the default arm, which is also the correct label for `undefined` (pre-first-frame) — so on an openai/openrouter deployment the score step never stops looking like it hasn't started resolving a provider.",
    "evidence": [
      "src/components/report/ReportClientStatus.tsx:37-51 — the switch; four cases + default",
      "src/lib/types.ts:8 — ProviderName = gemini | bedrock | openai | openrouter | mock | claude-cli",
      "src/lib/llm/index.ts:67 — PROVIDER_CHOICES includes openai and openrouter",
      "src/lib/llm/index.ts:106-108,147-148 — both are fully wired provider branches",
      "branch audit (all six enumerated in the report body): gemini CLEAN, claude-cli CLEAN, bedrock CLEAN (region-aware), mock CLEAN, undefined CLEAN-by-design, openai UNCOVERED, openrouter UNCOVERED"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "scope_note": "Emitted to discharge the enumerate-every-branch duty. Unreachable on this host.",
    "l2_priority": "Not worth browser time on this host. PRECONDITION: would require LLM_PROVIDER=openai or openrouter with a working key — NOT satisfiable on this host (LLM_PROVIDER=claude-cli). If not run, resolve `uncertain — not reproducible on this host`, never refuted.",
    "reachable": false
  },
  {
    "id": "SAM-L1-STR-01",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — the D2 detector samples test BODIES and docks 15 points for assertion theater, which is this Character's exact scar tissue answered in code",
    "expected": "n/a — positive finding.",
    "got": "analyze/index.ts:329-336 samples test file bodies and, when substantive assertions are absent, applies `s.add(-15, 'Sampled tests assert nothing', '<n> sampled test file(s), ~<cases> cases, 0 substantive assertions — counting files, not behavior')`; the positive branch credits 'Sampled tests assert behavior' with the substantive count. Sam's background names precisely this failure ('a coverage number that was 80% and meant nothing because the assertions were expect(true).toBe(true)') and his top pet peeve is 'scoring on the PRESENCE of a file instead of whether it's real and followed'. This is the one place the product refuses to grade on presence — and note it is also one of the only two `detail:` fields on this path, i.e. it is more re-traceable than its neighbours.",
    "evidence": [
      "src/lib/analyze/index.ts:329-336 — the negative and positive branches with their detail strings",
      "uat/characters/sam-staff-engineer.md:17 — the coverage-theater burn",
      "uat/characters/sam-staff-engineer.md:31 — 'Scoring on the presence of a file … instead of whether it's real and followed'"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "scope_note": "Do-not-touch guardrail: any future rework of the D2 detector or its evidence rendering must preserve the assertion-substance sample AND its detail string. It is the single highest-trust line this Character will read.",
    "l2_priority": "Optional. Confirm the line renders verbatim on a repo with hollow tests. PRECONDITION: any provider (deterministic detector); needs a fixture repo with assertion-free tests.",
    "reachable": true
  },
  {
    "id": "SAM-L1-STR-02",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "STRENGTH — the scan wait is a six-stage, provider-named, monotonic, elapsed-clocked progress surface, not a spinner",
    "expected": "n/a — positive finding.",
    "got": "Named stages fetch/tree/files/analyze/score/compose; the score step reads 'Asking Claude' on this host; a mount-anchored elapsed clock; a bar blending server pct with a provider-CALIBRATED time curve via max() so it only advances; a 15 s server heartbeat keeping proxies from dropping the SSE; a client backstop re-pinned per provider that can lengthen on failover but never shorten mid-scan; and a coalescing joiner told immediately that it attached to a run already in progress. Sam's pet peeve list ends with 'latency theater: a spinner with no streamed progress while a scan pretends to do deep work' — this is the direct refutation, and it is what makes the 193 s live scan tolerable.",
    "evidence": [
      "src/components/report/ReportClientStatus.tsx:27-34 — SCAN_STEPS",
      "src/components/report/ReportClientStatus.tsx:37-57 — provider-aware + fallback-aware score label",
      "src/components/report/ReportClientStatus.tsx:78-107 — useElapsed, displayProgressPct (max-blend, monotonic)",
      "src/app/api/scan/stream/route.ts:147-153 — 15s SSE heartbeat",
      "src/components/report/useReportScan.ts:98-116 — re-pinnable backstop (asymmetric: may lengthen, never shorten)",
      "src/app/api/scan/stream/route.ts:271-276 — the joiner is told it attached mid-run",
      "uat/characters/sam-staff-engineer.md:37 — the latency-theater pet peeve"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "scope_note": "Do-not-touch guardrail: any change to the scan wait must preserve named stages, the resolved-provider label, and bar monotonicity.",
    "l2_priority": "Confirm live that the checklist advances through all six stages and the bar never regresses across a ~190s claude-cli scan. PRECONDITION: LLM_PROVIDER=claude-cli (the mock path completes too fast to exercise the time curve).",
    "reachable": true
  },
  {
    "id": "SAM-L1-STR-03",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — the score is structurally defended against its own model: a guardband, a discrepancy budget the repo can't farm, a deterministic D9, and a persist path that refuses to cache a degraded run",
    "expected": "n/a — positive finding.",
    "got": "The LLM may move a dimension at most ±25 from the deterministic signal (engine.ts:205); D9 is computed by a graded OpenSSF-style battery and the prompt tells the model its D9 score field is IGNORED (prompt.ts:241, scan-score-input.ts:73-78); a discrepancy doubles the band but at most 2 per scan and all-or-nothing if the model over-claims (discrepancy-policy.ts:20,36-41), explicitly reasoned as removing the PAYOFF of a prompt injection rather than only its authority; repo content is fenced in an untrusted block with the authority denial stated twice (prompt.ts:81-83,244-251) and org decision notes are neutralize()d because agents write them (prompt.ts:118-131); and a degrade-to-mock / low-coverage / partial-PR-slice report is refunded, not cached, and not persisted (scan-finalize.ts:104-110, stream/route.ts:284-310). The header additionally discloses stochasticity ('AI estimate · may vary between runs') rather than hiding it. This is a threat model, not marketing — and it is why the number survives Sam's first re-check.",
    "evidence": [
      "src/lib/scoring/engine.ts:200-211 — guardband + blend",
      "src/lib/scoring/discrepancy-policy.ts:1-41 — the budget and its stated reasoning",
      "src/lib/scan-score-input.ts:73-78 — D9 replaced by the deterministic battery, flagged `deterministic`",
      "src/lib/scoring/prompt.ts:81-83,244-251 — untrusted boundary stated in SYSTEM and repeated at the block",
      "src/lib/scoring/prompt.ts:118-131 — decision notes neutralized because agents author them",
      "src/lib/scan-finalize.ts:104-110 and src/app/api/scan/stream/route.ts:284-310 — the four persist guards",
      "src/components/report/ReportHeader.tsx:33-34,122-130 — AI_ESTIMATE_HINT disclosure"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "scope_note": "Do-not-touch guardrail: any 'let the model have more latitude' change must keep the budget all-or-nothing and D9 deterministic.",
    "l2_priority": "n/a — structural, fully verifiable at L1.",
    "reachable": true
  }
]
```

**Estimated time-saved if it all worked: ~5 h 50 min per repo · confidence medium.** Realized today ≈ 5 h 20 min; the ~30 min delta is the re-grep SAM-L1-01 forces.

---

## Journey verdict

### `L1-conditional`

The job **completes** structurally: an anonymous visitor with no keys, no account and no DB dependency reaches a scored, evidenced, roadmapped report on a pasted public repo, with honest streamed progress and a score whose arithmetic I reproduced exactly from the code. The senior-quality bar is **met on substance** — the live `vercel/swr` read is one I would sign, the discrepancy about OIDC trusted-publishing provenance is a catch I would not reliably have made on a first pass, and the roadmap cites this repo's own numbers rather than a template.

It is `conditional`, not `pass`, because **two of Sam's seven scored criteria fail**, and both are his named automatic-failure conditions rather than nice-to-haves:
- **#2 evidence re-traceability** — the file detectors throw away the paths they matched, into a `detail` field built to hold them (SAM-L1-01). Sam's stated instant-trust-failure.
- **#6 the badge** — one of his three jobs-to-be-done has no path through the product at all (SAM-L1-03).

Both carry forward to L2 as majors. Neither is a structural blocker, so L2 is warranted and should spend its browser time on the `l2_priority` list above rather than re-walking the happy path.

---

## Sam's first-person review (L1 — over the *designed* experience)

**Would I adopt it?** Provisionally, yes — and I did not expect to write that. I came in expecting to catch it grading on the presence of files. Instead I found a detector that opens the test files and takes fifteen points off for `expect(true)` theater. That's the exact lie that burned me, caught in code, with the count in the string. Somebody on this team has been burned the same way.

**What delighted me.** The wait. Six named stages, "Asking Claude" instead of a spinner, an elapsed clock, and a bar that can't go backwards. Three minutes of that reads as work; ninety seconds of a spinner reads as a stall. Then the guardband: the model gets ±25 off the deterministic signal and no more, D9's number is computed and the prompt flatly tells the model its D9 score is ignored, and if the auditor claims more than two detectors are broken it earns *nothing* — with the reasoning written down, that this removes the *payoff* of an injection and not just its authority. That's a threat model. Most products in this category ship a vibe and a gradient. And the header chip that says the score may vary between runs — nobody ships that unless they mean it.

**What frustrated me.** I clicked into D2, saw 98, and went looking for where it came from. I got "Found 138 test files". Which 138? The `Signal` type has a `detail` field described as "path, count, etc." and across the whole file-detector module it's filled in exactly once — on the error placeholder. The machinery for the thing I need is built and left empty. So to defend this number upward I go re-grep the repo, which is the tedium I came here to skip.

And then the provenance track. Right instinct, and I'd have drawn the same picture. But it draws a fixed ±25 band when the engine actually widened D3 to ±50, and it never shows the blend weight — which is 0.51 on this scan, not the 50/50 the picture implies. The report *knows*: there's a `scoreIntegrity` object carrying `widenedDims` and `effectiveBlend`, computed, typed, persisted, and rendered by nothing. Zero components read it. That's not a hard fix; that's a panel nobody built. Same root cause under "Flagged for review", which lists two auditor claims and can't tell me that one of them landed on a deterministic dimension and therefore moved nothing.

**Does the output sound like a senior's read?** Yes, and I'm being careful saying it. "0 of 8 Action references pinned by SHA." "56% of merged PRs carry an approving review despite a rule requiring one — likely maintainer self-merges or an admin bypass." "Time-to-first-review 17.6h against time-to-merge 0.6h, an unusual gap." That last one is the sentence I'd have written, and it's the kind of thing a template can't produce. Nowhere near "add more tests." The one place it grates is the house voice: I get observations and open questions where I want a ticket. "Would pinning the 8 Action references to SHAs be a quick, low-risk first move?" — yes. Obviously. Put that in a field called "first step" and I'll paste it into Jira. I don't need to be asked whether I'd like my supply chain not to be compromised.

**Would I stake my name on the badge?** I can't get to the badge. There's no badge control anywhere on the report — PDF, share card, copy-for-LLM, SKILL.md, no badge — and when I finally find the generator in the footer it doesn't know which repo I just scanned, so I retype it. The generator itself is good, Markdown and HTML and AsciiDoc and the CI gate snippets. It's just not wired to the one screen where anybody would ever want it. That's a link, not a feature.

**What's missing for MY job.** History. The model has never seen this repo's own prior scans, so it can't tell me the thing I actually get asked: *did this get worse?* It can score a snapshot; it can't testify to a trajectory. And a file-tree manifest — twenty-two kilobytes of a two-hundred-and-eighty-kilobyte fetch reach the model with no map of what got left out, so when the auditor infers something from one workflow file I can't tell whether it looked and disagreed or simply never saw the rest.

**Would I tell a peer?** I'd say: run it on a repo you know cold, and go straight to the Dimensions tab. If the read matches yours, the rest of the product has earned the benefit of the doubt — the guardrails behind the number are more serious than anything else in this category. Then warn them they'll be re-grepping to source the evidence, and that if they want a README badge they'll be building the link themselves. It's about eighty percent of the way to the thing I'd stop doing by hand.
