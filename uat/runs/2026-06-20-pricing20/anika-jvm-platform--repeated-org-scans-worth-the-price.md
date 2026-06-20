# L1 — Anika (JVM platform lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring machinery (trajectory + R²/flat-floor + movers + practices) is structurally sound and the JVM repo *is* read fairly enough to be credible, but two majors blunt the recurring value for a 200-repo JVM rollout: (a) the file picker misses **Gradle Kotlin-DSL** build manifests, so a `.kts`-only repo can be under-read and its *repeated* score skewed; (b) the 200-repo fleet is **illegible as an adoption curve** — the overview movers are a top-5 teaser and the repositories table is an unsorted-by-movement 200-row wall, so "is the standard landing fleet-wide" is not answerable from the recurring surfaces. Renew (Enterprise, price isn't the issue) but with a sharp feature ask.

## Reachable surface set (tier-honest — Enterprise)
Anika is Enterprise: **unlimited scans, unlimited members, custom retention** (`src/lib/plans.ts:55-64`). Under `ASCENT_AUTH_BYPASS=1` on a populated org she reaches the full `/org/*` set as synthetic owner, and unlike the Free/Pro characters in this sweep **nothing here is gated away from her**:
- **Overview** `/org/[slug]/page.tsx` — fleet headline, **Trajectory** (`src/components/org/Trajectory.tsx`), **PeriodSummary** banner (`src/components/org/PeriodSummary.tsx`), **movers** top-5 (`page.tsx:281-282`).
- **Repositories** `/org/[slug]/repositories/page.tsx` → `RepoLeaderboard` — the full 200-repo table.
- **Executive** `/org/[slug]/executive`, **Practices** `/org/[slug]/practices` (playbook exemplar/gap), **Trends** `/trends`, **Usage** `/usage`.
- **Cadence** (scheduled rescans + alerts + digest) — Pro+ in the price book, so **included** at Enterprise; reachable. Note these require the GitHub App (`RepoLeaderboard.tsx:166,171` disabledHint), an integration prerequisite, not a tier gate.
- **Custom retention** (`retentionDays: null`) — her trajectory can look back as far as data exists; no 30/180/365 ceiling. This is the one tier privilege that *directly* helps the recurring read: a multi-quarter adoption curve is possible in principle.

## Surface-model notes (recurring-value affordances → file:line, grounding-audit emphasis)

**Repetition is required for the headline feature, and that's honest.** `forecastTrajectory` returns null below 2 distinct calendar days (`src/lib/maturity/forecast.ts:87,100`); the trajectory literally cannot render until she's scanned on ≥2 days — so the recurring read *earns* its place. ✔

**The noise defense exists and is surfaced where the move is shown.** `FLAT_PER_WEEK=0.5` (`forecast.ts:64`) flattens sub-noise drift to "holding"; `fitQuality` (R²) is rendered as **"trend confidence N% · noisy"** under the move (`Trajectory.tsx:92-97`). This is exactly the "is the move real" affordance Anika needs — and it's present, not missing. The residual risk is per-repo: the engine guardbands the LLM to ±25 of the deterministic signal and blends 60/40 (`src/lib/scoring/engine.ts:99-102`, `LLM_GUARDBAND`/`SCORE_BLEND`), so a single unchanged repo re-scanned under `claude-cli` can wobble *within* the guardband; the flat-floor/R² defense lives on the **fleet trajectory**, not on the per-repo row in `RepoLeaderboard`. For her this is acceptable — she reads the fleet, not single rows — but it's the L2 thing to confirm.

**JVM stack-fit — the score is mostly fair, with one real hole.** The archetype lens is **stack-agnostic** (CODEOWNERS + workflows + stars → "org"/"team"/"solo", `src/lib/analyze/index.ts:727-735`), so a JVM org repo gets the org lens regardless of language — good, no TS bias there. The file picker *does* grab `pom.xml` and `build.gradle` (`src/lib/github/source.ts:554-555`) and samples `.java`/`.kt` source (`source.ts:620`), and the manifest detector reads `pom.xml`/`build.gradle` (`src/lib/analyze/index.ts:44`). **But:** the picker's exact-name list and the manifest regex both know only `build.gradle` (Groovy) — **not** `build.gradle.kts`, `settings.gradle(.kts)`, `gradle/libs.versions.toml`, or `gradlew`. A modern Kotlin-DSL Gradle repo (Anika's exact stack) whose build is `build.gradle.kts`-only has its **build manifest missed by content fetch and by the manifest-text detector**. The ≤32-file sample still pulls README/CI/source, so it doesn't zero out — but the build-tooling signal that should anchor a Gradle repo's read is absent, and because the gap is *deterministic* it depresses the score the **same way every cycle**: a stable-but-wrong baseline, which is arguably worse for her than noise.

**200-repo adoption-curve legibility — the real recurring-value gap.** The standardization rollout is a *fleet adoption curve*, and the recurring surfaces don't render it:
- Overview movers are **sliced to top-5** gainers / top-5 regressers (`/org/[slug]/page.tsx:281-282`). For 200 repos, "12 repos adopted the convention this cycle" is invisible past the 5th.
- `getOrgMovers` itself computes the *full* set with correct period-baseline semantics (`src/lib/db/org-insights.ts:70-143`, half-open window, onboarded-mid-period handled at :113) and reports `comparedRepos` — so the data exists; the **overview just teases it.**
- The Repositories table sorts by **overall score, not by movement** (`repositories/page.tsx:31`) and `RepoLeaderboard` renders **every row unpaginated** (`RepoLeaderboard.tsx:112 rows.map`, no virtualization/filter). So the two ways to see the fleet are a 5-row teaser or a 200-row wall ordered by the wrong key. Neither answers "how many of 200 are on the standard, and was that more last month."
- `PeriodSummary` (`PeriodSummary.tsx:33-41`) gives a clean one-sentence net move + promoted/demoted counts + onboarded count — genuinely useful as her "re-pullable number," but it's a *scalar*, not the adoption *curve*.
- The **Practice Library** (`org-insights.ts:648-699`) is the closest thing to an adoption read: per practice it names the exemplar and the `gapRepos` (score < 40) — but it's a *current-snapshot* gap list, not a cycle-over-cycle "the gap shrank from 80 to 60 repos" delta. No explicit golden-path **Adoption Rate** ("% of fleet on the standard") metric exists, which is the headline number platform-eng practice expects ([env0 golden-paths](https://www.env0.com/insights/why-golden-paths-matter-in-modern-platform-engineering)).

**Benchmark cohort is language-keyed — a quiet JVM trap.** `getOrgBenchmark` builds the peer cohort from `primaryLanguage` (`org-insights.ts:604-616`), needs ≥5 same-language peers (`COHORT_MIN`), and GitHub's `language` for a mixed Kotlin/Java Gradle repo reports a *single* dominant language inconsistently — so her dominant-language cohort may be "Kotlin" one cycle and "Java" the next, or fall below 5 peers and show null. Minor for her recurring job (she cares about her own fleet, not the corpus), but it's a place the "Java shop vs TS-centric corpus" read can mislead.

## Findings (impact-scored)

```json
[
  {
    "id": "anika-jvm-gradle-kts-missed",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Gradle Kotlin-DSL build manifests (build.gradle.kts / settings.gradle.kts / libs.versions.toml) are not picked or detected — a .kts-only JVM repo is under-read identically every cycle",
    "expected": "A modern Gradle/Kotlin repo's build manifest is fetched and read so its score reconciles with the codebase and is credible for a Java shop.",
    "got": "The picker's exact-name list and the manifest-detector regex know only `pom.xml` and `build.gradle` (Groovy). `build.gradle.kts`, `settings.gradle(.kts)`, `gradle/libs.versions.toml`, and `gradlew` match neither, so a Kotlin-DSL build is invisible to manifest-based signals. Because the miss is deterministic, the repeated score is stably-wrong, not noisy.",
    "evidence": ["src/lib/github/source.ts:554-555", "src/lib/analyze/index.ts:44", "src/lib/github/source.ts:620"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Scan a real build.gradle.kts-only repo under claude-cli; confirm whether D1/CI/build signals reflect the Gradle setup or read as if there were no build, and whether the score is defensibly low or wrongly low.",
    "suggested_acceptance": "Add `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `gradle/libs.versions.toml`, `gradlew` to the exact-name picker list and the manifest-detector regex so a Kotlin-DSL Gradle repo's build is read."
  },
  {
    "id": "anika-200-repo-adoption-curve-illegible",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No fleet-wide adoption-curve / movement view: overview movers are a top-5 teaser and the 200-repo table is unsorted-by-movement and unpaginated",
    "expected": "Cycle over cycle she can see the standardization landing across 200 repos — 'N of 200 on the standard / N moved, was M' — the way platform-eng tracks golden-path Adoption Rate.",
    "got": "Overview shows only `slice(0,5)` gainers + 5 regressers; the Repositories table sorts by overall score (not movement) and renders all 200 rows unpaginated with no movement column. getOrgMovers computes the full set but it isn't surfaced as a curve, and there is no 'adoption rate %' metric.",
    "evidence": ["src/app/org/[slug]/page.tsx:281-282", "src/app/org/[slug]/repositories/page.tsx:31", "src/components/org/RepoLeaderboard.tsx:112", "src/lib/db/org-insights.ts:138-142"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "On a ~200-repo seeded org, check whether a leader can answer 'how many repos adopted the standard this cycle and was that more than last cycle' from the overview/repositories surfaces without exporting data.",
    "suggested_acceptance": "Surface the full movers list (or top-N with a 'see all N movers' link) and add a fleet adoption-rate / version-consistency metric with its period delta."
  },
  {
    "id": "anika-per-repo-rescan-noise-unlabelled",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Per-repo row score moves carry no real-vs-noise label; the flat-floor/R² defense lives only on the fleet trajectory",
    "expected": "When a single repo's score changes on re-scan, she can tell whether it's a real change or the model breathing within the ±25 guardband.",
    "got": "Fleet Trajectory surfaces R² as 'trend confidence · noisy' (good), but RepoLeaderboard rows show a bare overall/adopt/rigor with no per-repo confidence or noise band; the guardband+60/40 blend can wobble an unchanged repo within ±25.",
    "evidence": ["src/lib/scoring/engine.ts:99-102", "src/components/org/Trajectory.tsx:92-97", "src/components/org/RepoLeaderboard.tsx:153-157"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "Re-scan one unchanged JVM repo twice under claude-cli; measure the per-repo overall delta and confirm nothing in the UI labels it as noise.",
    "suggested_acceptance": "Show a per-repo movement with a noise-band hint (e.g. dim moves within ±guardband) so a fleet of 200 doesn't read 200 spurious micro-moves as signal."
  },
  {
    "id": "anika-benchmark-cohort-language-keyed",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Peer-cohort benchmark keys on GitHub primaryLanguage, which is unstable for mixed Kotlin/Java Gradle repos",
    "expected": "A 'vs your Java peers' read that's stable cycle over cycle.",
    "got": "Cohort = corpus repos sharing the org's dominant primaryLanguage, ≥5 peers required; a mixed Kotlin/Java estate's dominant language can flip between cycles or fall below 5, showing null or a different cohort.",
    "evidence": ["src/lib/db/org-insights.ts:604-616", "src/lib/db/org-insights.ts:542"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Low — confirm the cohort language and peer count on a JVM-seeded corpus; verify it doesn't swing cycle-to-cycle."
  },
  {
    "id": "anika-strength-trajectory-noise-defense",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: the recurring read has a real noise defense — flat-floor + R² 'trend confidence · noisy' surfaced exactly where the move is shown, and the trajectory requires ≥2 days so repetition genuinely earns the feature",
    "expected": "A way to tell a real fleet move from re-scan noise on the recurring read.",
    "got": "FLAT_PER_WEEK=0.5 flattens sub-noise drift; fitQuality rendered as 'trend confidence N% · noisy' below the ETA; forecast returns null under 2 distinct days so the feature can't render on a single scan.",
    "evidence": ["src/lib/maturity/forecast.ts:64", "src/components/org/Trajectory.tsx:92-97", "src/lib/maturity/forecast.ts:87"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  },
  {
    "id": "anika-strength-period-summary-repullable-number",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH: PeriodSummary gives the one re-pullable sentence a VP wants — net maturity delta, promoted/demoted counts, onboarded-this-period — cohort-matched so it isn't diluted by new repos",
    "expected": "One consolidated, re-pullable number + direction per cycle, not a dashboard to re-interpret.",
    "got": "PeriodSummary renders 'Fleet maturity climbed +N to X', promoted/demoted counts, and onboarded count, with cohort-matched deltas (baseline.repos vs scannedCount) so onboarding is reported separately.",
    "evidence": ["src/components/org/PeriodSummary.tsx:33-41", "src/components/org/PeriodSummary.tsx:25-31"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (Anika, first person)

Would I renew? Yes — but not because it wowed me, because I'm Enterprise and the price isn't the conversation. The honest question is whether I can finally retire the spreadsheet, and the answer this cycle is "mostly, with a caveat I'd raise in the QBR."

Is each cycle telling me something new? At the fleet *scalar* level, yes — the "Quarter in review" sentence is exactly the line I'd paste into a VP deck: maturity moved +N to X, four repos leveled up, three onboarded. That's a re-pullable number, I like it. But my actual job is the **adoption curve across 200 repos**, and that I can't see. The overview gives me the top five movers — out of two hundred. The repositories table gives me all two hundred, sorted by overall score, with no "what moved" column, so I'm scrolling a wall to reconstruct by hand the exact thing I came here to stop doing by hand. The data's clearly in there — the movers query knows the full set — it's just not drawn as a curve. So this cycle told me the *fleet average* moved; it did not tell me "the convention plugin is on 140 repos now, was 120." For a standardization rollout that's the whole ballgame.

Did it read my stack? Mostly. The lens isn't TS-biased — a governed org repo gets the org weighting regardless of language, good. It grabs `pom.xml` and `build.gradle`. But half my estate is Kotlin-DSL — `build.gradle.kts`, a `libs.versions.toml` version catalog — and *none* of those are in what it fetches or what the build-signal detector reads. So a `.kts`-only service looks to Ascent like it has no build at all. The nasty part is it's not random: it's wrong the **same way every month**, so the repeated number is stable *and* wrong, which is the version I can't catch by eye. I'd have to know to distrust it.

Do I trust a move is real? On the fleet trajectory, yes — the "trend confidence · noisy" tag and the flat-floor are exactly right, that's the bit that tells me a +2 isn't the model breathing. On a single repo row, no — there's no per-repo noise hint, so across 200 repos I'd see a haze of one- and two-point jitter I can't tell from signal. I read the fleet, not rows, so it's survivable, but I'd want it labelled before I let a team lead stare at their own repo's wobble.

Does the cost pencil out / can I see the price? At Enterprise the subscription $ is "contact us" and that's fine — I already signed. What has to pencil out is *value*, and retention being custom is the one tier perk that actually helps me: my adoption curve can look back as far as I've got data, no 30/180/365 ceiling. So the economics are fine; the gap is purely whether the fleet read does my job.

What's missing for MY recurring job? A **fleet adoption-rate metric with a period delta** — "% of repos on the golden path, N now vs M last cycle" — and the **full mover list**, not a teaser. Plus Gradle-`.kts` support so I'm not quietly under-counting half my fleet. Would I tell a peer? A JVM platform peer — yes, with the asterisk: "great trajectory and a noise label that actually works; check whether it reads your Gradle builds, and don't expect a real adoption curve across a big fleet yet."

## Grounding score · time-saved · pricing verdict

- **Grounding (recurring-context sources that reach the read): 5 / 7.**
  Reach the read: (1) trajectory needs real history ✔ (`forecast.ts:87`); (2) noise label on the fleet move ✔ (`Trajectory.tsx:92-97`); (3) period deltas/movers compute vs previous with provenance ✔ (`org-insights.ts:70-143`, `PeriodSummary.tsx`); (4) retention supports the lookback ✔ (Enterprise custom, `plans.ts:62`); (5) practice-library exemplar/gap as an adoption proxy ✔ (`org-insights.ts:648-699`). **Don't fully reach:** (6) the JVM build signal — missed for `.kts` repos, so the *repeated* score is grounded on incomplete signal (`source.ts:554`); (7) a fleet **adoption-rate / movement curve** across 200 repos — absent as a surface, so the standardization-landing read isn't grounded in anything she can see.
- **Per-cycle time-saved (if it all worked): ~20 hours/cycle** — replaces the ~3 engineer-day (~24h) manual adoption scorecard with a sub-hour re-pull. **Today's realized saving is lower (~8-10h):** the fleet scalar + practices land, but she still hand-reconstructs the adoption curve across 200 repos and has to sanity-check `.kts` repos, clawing back hours the design promised.
- **Verdict: RENEW** (Enterprise — price isn't the lever) — *but conditional on the feature ask.* One-line reason: the noise defense and re-pullable number are real and the stack lens is fair, but until it reads Gradle-`.kts` and draws a fleet adoption curve, it's a better scorecard than her spreadsheet rather than a replacement for the manual rollout-tracking it's meant to retire.

## l2_priority carry-forward
1. **(top)** Scan a `build.gradle.kts`-only / `libs.versions.toml` JVM repo under `claude-cli`; confirm whether the build/CI/D1 signals reflect the Gradle setup or read as "no build," and whether the resulting score is defensibly low vs wrongly low — and crucially **stable across two re-scans** (deterministic miss → stably-wrong baseline).
2. On a ~200-repo seeded org, verify whether a leader can answer "how many repos adopted the standard this cycle, and was that more than last cycle" from the overview/repositories surfaces without exporting — i.e. is the adoption curve legible or does it collapse to a 5-row teaser / 200-row wall.
3. Re-scan one unchanged JVM repo twice; measure the per-repo overall delta within the ±25 guardband and confirm nothing labels it as noise at the row level.
