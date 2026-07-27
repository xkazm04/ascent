# L1 — Anika (JVM platform lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the repos×time refactor (`RepoCategoryRollup` + `buildTrajectories` + `RepoDimensionHeatmap`) substantially *improves* fleet legibility since the prior L1 pass (2026-06-20) and the noise-vs-signal defense is now even more rigorous (deltas spanning a mock→live engine transition are explicitly excluded from "moved" counts, not just guardbanded). But the one finding that mattered most for Anika specifically — **Gradle Kotlin-DSL build manifests are still not fetched or detected** — is unresolved: the fetch picker and the manifest-text detector still only know `pom.xml`/`build.gradle` (Groovy), so a `.kts`-only repo (her exact stack, half her fleet) is under-read identically every cycle. That's a major that blunts her senior-quality bar even though the recurring-value machinery around it got materially better.

## Reachable surface set (tier-honest — Enterprise)
Anika is Enterprise: unlimited scans, unlimited members, custom (`null`) retention (`src/lib/plans.ts:27,77`). Under `ASCENT_AUTH_BYPASS=1` on a populated org she reaches the full `/org/*` set as synthetic owner — nothing is gated away from her at this tier:
- **Overview** `/org/[slug]/page.tsx` — now a two-instrument repos×time view: `RepoCategoryRollup` (`page.tsx:125`) and `RepoDimensionHeatmap` (`page.tsx:131`).
- **Repositories** `/org/[slug]/repositories/page.tsx` → `RepoLeaderboard` (`repositories/page.tsx:142`) — the full fleet table, sorted by overall score (`repositories/page.tsx:67`).
- **Executive** `/org/[slug]/executive` (still renders the fleet `Trajectory` card, `executive/page.tsx:155`), **Practices** `/org/[slug]/practices`, **Trends** `/trends` (`trends/page.tsx:156` — the fleet ETA/noise-confidence card), **Usage** `/usage`, **Pricing** `/pricing`.
- **Cadence** (scheduled rescans + digest) — Pro+ in the price book, included at Enterprise; gated only by the GitHub App being configured (`repositories/page.tsx:65` `isAppConfigured()`), not by her tier.
- **Custom retention** (`retentionDays: null`, `plans.ts:77`) — her multi-quarter adoption curve can look back as far as data exists; no 30/180/365 ceiling.

## Surface-model notes (recurring-value affordances → file:line)

**The Overview was rebuilt around exactly the question Anika asks — and it's an upgrade over the prior L1 pass.** `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`) joins every scanned repo's latest snapshot with its full per-scan history and computes, per repo: `deltaWindow` (net move across the period), `deltaLast` (most recent step), and — new and important — `deltaCrossesEngine` (`repoTrajectory.ts:61`), which flags when a delta spans a mock→live engine change so a seed-to-real-scan jump is never dressed up as genuine movement. `movedRepos()` (`repoTrajectory.ts:165-167`) filters to repos with *real* non-engine-transition movement — this is the honest denominator for "how many of my fleet actually moved."

`RepoCategoryRollup` (`src/components/org/overview/RepoCategoryRollup.tsx`) renders **every** repo (not a top-5 teaser), grouped by Type/Stack/Level (switchable, `RepoCategoryRollup.tsx:34-39`), each row showing its own `overall` score and `deltaWindow` with a muted style when it crosses an engine transition (`RollupRow`, `RepoCategoryRollup.tsx:118-133`). The fleet masthead line (`RepoCategoryRollup.tsx:232-255`) gives the exact re-pullable sentence Anika wants: `{repos} repos · avg {X} · ▲{improving} ▼{slipping} →{holding} · avg move {±N} · {mock} mock` — this is a materially stronger "N of 200 moved, was M" read than the prior top-5 movers slice it replaced.

**JVM stack-fit — still the real hole, unresolved by this refactor.** The tech-extraction layer *was* extended for Kotlin-DSL: `tech-extract.ts:187-191` now calls `get("build.gradle.kts")` and even detects Kotlin via `.kt`/`.kts` file paths. But this only works if the file was actually fetched — and it wasn't:
- The content-fetch picker's exact-name allowlist (`src/lib/github/source.ts:613-654`) still lists only `"pom.xml"` (line 627) and `"build.gradle"` (line 628) — **no** `build.gradle.kts`, `settings.gradle(.kts)`, `gradle/libs.versions.toml`, or `gradlew`.
- The source-file sampler (`source.ts:687-695`) matches `\.(ts|tsx|js|jsx|py|go|rs|java|rb|kt|cs|php)$` — `.kt` is included but **`.kts` is not**, so even the generic "grab some source files for texture" fallback misses Kotlin-DSL build scripts.
- The deterministic manifest-text detector (`src/lib/analyze/index.ts:46-54`) that several dimension detectors read (`allText`, `index.ts:65-67`) still regexes only `pom\.xml|build\.gradle` (`index.ts:48`) — no `.kts` variant.
- Net effect: `tech-extract.ts`'s new `get("build.gradle.kts")` call almost always resolves to `undefined` in practice (the file was never in `snap.files`), so the Kotlin-DSL parsing code added there is largely dead for the fetch-then-analyze path. A `.kts`-only Gradle repo's build manifest is invisible to both the LLM prompt (never fetched) and the deterministic signal (regex never matches) — **the same way, every cycle** — a stable-but-wrong baseline, which for Anika's repeated read is worse than noise because she can't catch it by eye.

**The noise defense is present at both the fleet level and (now, more precisely) the per-repo level.** Fleet: `forecastTrajectory` still requires ≥2 distinct calendar days to render (`src/lib/maturity/forecast.ts`, unchanged from prior pass) and `Trajectory.tsx:89-103` renders "trend confidence N% · noisy" (or an explicit "low data" caveat under 3 points) on `/trends` and `/org/[slug]/executive`. Per-repo (new since the prior pass): `deltaCrossesEngine` (`repoTrajectory.ts:61`) is muted in the UI with an explicit title ("an engine transition, not a real code-change delta", `RepoCategoryRollup.tsx:120-127`) — this closes part of the prior run's "per-repo rescan noise unlabelled" minor finding (the mock→live jump specifically), though a same-engine LLM-guardband wobble (±25 blend, `src/lib/scoring/engine.ts`) still renders as a plain colored delta with no noise-band hint.

**Practice Library remains a current-snapshot gap list, not a cycle-over-cycle delta**, unchanged from the prior pass (`src/lib/db/org-insights.ts:691-759`): per practice it names an `exemplar` and `gapRepos` (score < 40) but there's still no "the gap shrank from 80 to 60 repos" trend and no explicit golden-path Adoption Rate % metric — though the new fleet masthead's `improving`/`avgMove` numbers now partially substitute for that at the whole-fleet level (not per-practice).

**The old page-level `PeriodSummary` one-sentence card is gone** (`src/components/org/overview/PeriodSummary.tsx` no longer exists in `src/components`; only an orphaned `PeriodSummary.test.ts` remains, and no `src/app/**` file imports it) — but its job is subsumed, arguably better, by the new fleet masthead line in `RepoCategoryRollup` described above. Not a regression in substance, but the orphaned test file is a small hygiene note.

## Findings (impact-scored)

```json
[
  {
    "id": "anika-jvm-gradle-kts-still-missed",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Gradle Kotlin-DSL build manifests still aren't fetched or deterministically detected, despite tech-extract.ts adding .kts parsing — the fetch/detect layers weren't updated to feed it",
    "expected": "A Kotlin-DSL Gradle repo's build.gradle.kts / settings.gradle.kts / libs.versions.toml is fetched and its build signal reflected, so the repeated score reconciles with her actual stack.",
    "got": "tech-extract.ts:187-191 now calls get(\"build.gradle.kts\") and detects Kotlin via .kt/.kts paths, but source.ts's exact-name picker (613-654) and source-file sampler (687-695, regex excludes .kts) never fetch build.gradle.kts, and analyze/index.ts:48's manifest-text regex still matches only pom.xml|build.gradle. The new .kts-aware code is effectively unreachable in the fetch-then-analyze pipeline.",
    "evidence": ["src/lib/analyze/tech-extract.ts:187-191", "src/lib/github/source.ts:613-654", "src/lib/github/source.ts:687-695", "src/lib/analyze/index.ts:46-54"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Scan a real build.gradle.kts-only repo (e.g. a Kotlin Gradle-DSL project) under claude-cli twice; confirm whether D1/build/CI signals reflect the Gradle setup or read as 'no build', and whether the score is stable-but-wrong across both scans.",
    "suggested_acceptance": "Add build.gradle.kts, settings.gradle, settings.gradle.kts, gradle/libs.versions.toml, gradlew to source.ts's exact-name picker list, extend the source-sampler regex to include .kts, and extend analyze/index.ts's manifestText regex to match build\\.gradle(\\.kts)? — so the tech-extract.ts Kotlin-DSL parsing that already exists actually receives content."
  },
  {
    "id": "anika-strength-fleet-legibility-upgrade",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "STRENGTH: the Overview refactor resolves most of the prior run's '200-repo adoption curve illegible' major — every repo now renders (grouped, not a top-5 teaser) with its own delta, and a fleet masthead gives the exact re-pullable 'N moved / avg move' sentence",
    "expected": "Cycle over cycle she can see the standardization landing across the fleet without a top-5 teaser or an unsorted wall.",
    "got": "RepoCategoryRollup.tsx renders every repo grouped by Type/Stack/Level with per-row deltas (118-133), plus a fleet masthead ('{repos} repos · avg X · ▲N ▼N →N · avg move ±N', 232-255) computed from movedRepos()/avgRealMove() which correctly excludes single-scan and mock→live engine-transition deltas from the movement count (repoTrajectory.ts:165-172).",
    "evidence": ["src/components/org/overview/RepoCategoryRollup.tsx:118-133", "src/components/org/overview/RepoCategoryRollup.tsx:232-255", "src/components/org/overview/repoTrajectory.ts:165-172"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  },
  {
    "id": "anika-per-practice-adoption-rate-still-absent",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "No per-practice / golden-path adoption-rate metric with a period delta — Practice Library is still a current-snapshot gap list",
    "expected": "'The convention plugin is on 140/200 repos now, was 120 last cycle' — a named-practice adoption rate over time, per platform-eng golden-path norm.",
    "got": "getOrgPractices (org-insights.ts:710-759) computes exemplar + gapRepos (score < 40) as of NOW, with no cycle-over-cycle gap delta and no explicit adoption-rate %. The new fleet-level improving/slipping/avgMove numbers are a whole-fleet proxy but don't answer 'did THIS specific practice spread'.",
    "evidence": ["src/lib/db/org-insights.ts:710-759", "src/components/org/overview/RepoCategoryRollup.tsx:232-255"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Low — confirm on a seeded 200-repo org whether Practices page shows any period-over-period gap-count change, or purely a snapshot."
  },
  {
    "id": "anika-same-engine-guardband-wobble-still-unlabelled",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Per-repo deltas now correctly mute mock→live engine-transition jumps, but a same-engine LLM-guardband wobble on an unchanged repo still renders as a plain colored delta with no noise hint",
    "expected": "When an unchanged repo's score wobbles within the LLM's ±25 guardband on re-scan, the row visually distinguishes that from a real code-change move.",
    "got": "deltaCrossesEngine correctly mutes mock→live deltas (repoTrajectory.ts:61, RepoCategoryRollup.tsx:120-127), but a same-engine (claude-cli → claude-cli) delta on an unchanged repo gets the normal deltaHex-colored treatment (RepoCategoryRollup.tsx:130-133) — no guardband/noise-band affordance at the row level.",
    "evidence": ["src/components/org/overview/repoTrajectory.ts:61", "src/components/org/overview/RepoCategoryRollup.tsx:118-133", "src/lib/scoring/engine.ts:99-102"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "Re-scan one unchanged JVM repo twice under claude-cli; measure the per-repo overall delta and confirm whether it's small enough to not mislead, or whether it needs a row-level noise hint."
  }
]
```

## Character feedback (Anika, first person)

Would I renew? Yes — I'm Enterprise, price was never the question. Did this cycle's rebuild make the recurring read better? Genuinely, yes, more than I expected. The old top-5 movers list is gone and I don't miss it: now I get every repo, grouped by type or stack or level, each with its own move, and one line at the top that says exactly what I'd paste into a deck — repos, avg, how many climbed, how many slipped, how many held, the average move, and how many are still on the mock floor. That's the "N moved, was M" sentence I asked for last time, basically. And the engine-transition muting is a nice touch I didn't ask for: a repo that jumped because it went from a seeded mock score to a real claude-cli scan doesn't get dressed up as three points of real progress. That's exactly the kind of "is this signal or an artifact of how the data got there" thinking I want from a tool that wants my trust.

Did it read my stack, finally? No — and this is the one that actually costs me. I can see someone tried: there's now code that reads `build.gradle.kts` for tech detection. But when I traced it, that code never gets fed anything, because the file-fetch step and the deterministic manifest check were never updated to grab `.kts` files in the first place. So it's parsing logic pointed at an empty box. Half my fleet is Kotlin-DSL. Those repos still look, to the build-signal check, like they have no build file. That's not a new problem, that's the *same* problem from before with a half-finished fix bolted onto one end of it. And it's the worst kind of wrong for a repeated read: consistent. I won't catch it by eye because it doesn't wobble — it's wrong the same way every single cycle. I'd have to already know to distrust it before I'd catch it, which defeats the point of an external check.

Do I trust a move is real? More than before. Fleet-level, yes, same as last time — the trend-confidence tag on `/trends` and `/executive` is solid. Row-level, better than before for one specific case (mock-seed-to-live jumps are now muted) but not solved for the case I actually see every month: an unchanged repo's score drifting a couple points because the model breathes within its guardband. That's still just a colored delta with no asterisk.

What's missing for MY recurring job, still? Feed the `.kts` reader something to read — that's a small, mechanical fix and it's the one that determines whether I trust the number for a Java shop at all. And a per-practice adoption delta — "convention plugin: 140 now, was 120" — the fleet-level version I have now is close but it's not the specific golden-path metric platform engineering actually reports on.

Would I tell a peer? Yes, with the same asterisk as before, slightly softened: "the fleet view got a real upgrade, the noise handling is more careful than it was — but check whether it actually reads your Gradle builds before you trust a JVM-heavy fleet's score, because as of today it still doesn't."

## Grounding score · time-saved · pricing verdict

- **Grounding (recurring-context sources that reach the read): 5 / 7.**
  Reach the read: (1) trajectory needs real multi-day history ✔ (`forecast.ts`, unchanged); (2) fleet-level noise label (trend confidence / low-data) ✔ (`Trajectory.tsx:89-103`); (3) per-repo engine-transition noise muting ✔ (`repoTrajectory.ts:61`, new this cycle); (4) period-over-period movement computed and surfaced fleet-wide, not teased ✔ (`RepoCategoryRollup.tsx:232-255`, materially better than the prior top-5 teaser); (5) retention supports the lookback ✔ (Enterprise custom, `plans.ts:77`). **Don't reach:** (6) the JVM build signal — `.kts` still unfetched/undetected despite the new tech-extract parsing code sitting downstream of an empty input (`source.ts:613-654`, `index.ts:48`); (7) a **named golden-path practice's** adoption-rate delta — the fleet-wide improving/slipping numbers are a good proxy but not the per-practice "convention plugin: N now, was M" metric platform-eng actually reports.
- **Per-cycle time-saved (if it all worked): ~20 hours/cycle** — replaces the ~3 engineer-day (~24h) manual adoption scorecard with a sub-hour re-pull. **Today's realized saving is higher than the prior L1 pass estimated (~12-14h)**: the fleet legibility gap that used to force her to hand-reconstruct "who moved" is now mostly closed by the masthead + grouped rollup, so she keeps more of the promised time. The remaining tax is entirely the `.kts` gap — she still has to manually sanity-check (or mentally discount) every Kotlin-DSL repo's score, which for "half her estate" is not a small asterisk.
- **Verdict: RENEW** (Enterprise — price isn't the lever) — *conditional on the Gradle-`.kts` fix.* One-line reason: the recurring-legibility problem she raised last cycle got a real, substantive fix; the stack-fairness problem did not — and for a JVM platform lead, an external tool that can't read half her fleet's build file is the harder trust problem of the two.

## l2_priority carry-forward
1. **(top, unchanged priority)** Scan a `build.gradle.kts`-only / `libs.versions.toml` JVM repo under `claude-cli`; confirm whether build/CI/D1 signals reflect the Gradle setup or read as "no build," and whether the resulting score is stable-but-wrong across two re-scans.
2. On a seeded fleet with a mock→live transition on some repos, confirm live that `RepoCategoryRollup`'s engine-transition muting actually renders correctly (not just in code) and that the masthead's improving/slipping/avgMove counts match a hand count.
3. Re-scan one unchanged JVM repo twice under `claude-cli`; measure the per-repo overall delta within the guardband and confirm whether the row-level presentation is misleading without a noise hint.
4. Low priority: confirm the Practices page shows (or doesn't show) any cycle-over-cycle gap-count change on a multi-scan seeded org.
