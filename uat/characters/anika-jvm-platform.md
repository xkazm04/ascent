---
name: Anika (JVM platform lead)
role: Platform Engineering Lead (owns the standardization rollout across a 200-repo Java/Kotlin/Gradle estate; ~400 engineers)
maps_to: /org/[slug] (overview · Trajectory · movers/period), /org/[slug]/executive, /org/[slug]/repositories, /org/[slug]/practices, /trends, /usage, /pricing
tech_level: power-user
promotion: discovery
references:
  - https://www.env0.com/insights/why-golden-paths-matter-in-modern-platform-engineering — platform-eng standardization is measured as Adoption Rate (% of services on the golden path, target >80%) + Version Consistency (% on the latest supported lib version), tracked across repos cycle-over-cycle. Sets the bar: the recurring read must show the standard *landing across the fleet*, not just a fleet-average score. (WebSearch 2026-06)
  - https://leanopstech.com/blog/platform-engineering-in-2025-the-future-of-developer-productivity/ — 2025 platform-eng signal: "the metric is flow, not headcount/tools"; track whether standardized pipelines actually moved delivery, month over month. Sets the bar that a re-pullable trend with confidence beats a re-rendered snapshot.
---

## Who they are
Anika runs the platform engineering group at a ~400-engineer Java/Kotlin/Gradle enterprise — roughly 200 private repos, Spring Boot services, a shared internal build/convention layer she's spent a year pushing. She's on Ascent **Enterprise**; price is barely a line item. What she's buying is a defensible, *external* read that her standardization rollout is actually landing across the fleet, so she can show it to a VP without it looking like her own team grading its own homework.

## Background / lived experience
Came up as a JVM backend engineer, then SRE-adjacent, now leads the platform team that owns the golden path: a Gradle convention plugin, a shared CI template, CODEOWNERS hygiene, a Spring starter set. Her current "is the rollout working" artifact is a hand-rolled **platform-adoption scorecard** — a spreadsheet her team refreshes monthly by grepping ~200 repos for "are they on the convention plugin / the shared workflow / the current Spring BOM," about **3 engineer-days a month**. She's been burned by tooling built for a TS/JS world that quietly under-reads a JVM repo: scanners that look for `package.json` and `eslint`, miss `build.gradle.kts` and `gradle/libs.versions.toml`, and then hand her a confidently-low score she has to spend a meeting explaining away. She answers to a VP who wants one number and a direction, and she's allergic to a number that wobbles when nothing changed — re-scan noise reads as "this tool isn't real."

## Voice
Precise, dry, stack-literal. "Did it even read the build?" is her first reflex on any score. She says "the convention plugin," "the BOM," "`.kts` not Groovy," "golden path," "adoption rate" — and she'll notice instantly if a tool only speaks `npm`. On trends: "I don't need a prettier number, I need to know the standard is on 140 of 200 repos and that was 120 last month." On noise: "if it moved three points and nobody pushed, that's your model breathing, not my fleet." Her highest praise is grudging and specific: "fine — it found the Gradle plugin and it didn't move when I re-ran it. That I can show the VP."

## Jobs to be done
- Each cycle, prove the **standardization rollout is landing across the 200-repo fleet** — more repos on the golden path than last month — with an external, defensible read, not my own spreadsheet.
- Trust that a JVM/Gradle/Spring repo gets a **fair, repeatable** score (the build manifest is actually read), so the *repeated* number is credible and stable for a Java shop.
- Tell a real fleet *move* from **re-scan noise** before I take it to a VP.

## What "good" looks like (acceptance expectations)
- The recurring read shows the standard **landing across the fleet** — an adoption curve / mover count that says "N of 200 now, was M" — not just a re-rendered fleet-average. Per golden-path practice, adoption rate + version consistency across repos is the metric.
- A JVM/Gradle/Spring repo's score **reconciles with what she knows** (it read `build.gradle`/`build.gradle.kts`/`pom.xml`, not just the absence of `package.json`), and is **stable on re-scan** when nothing changed.
- The 200-repo fleet is **legible** — movers/leaders don't collapse into a 5-row teaser or an unsorted 200-row wall; she can see *who moved* this cycle.
- A score move is labelled **real vs. noise** (trend confidence / flat-floor) where the move is shown.

## Pet peeves / friction triggers
- A score that under-reads a Gradle/Kotlin repo because the picker only knows `package.json`/`build.gradle` (Groovy) and missed `build.gradle.kts` / `settings.gradle.kts` / `libs.versions.toml`.
- A "fleet maturity +2" headline with no way to see *which* of 200 repos moved or whether the standard spread.
- A number that wobbles within the guardband on a re-scan of an unchanged repo, with nothing saying "that's noise."
- Per-developer ranking. She manages a rollout, not people.

## Motivation — why use the app at all (time-saved)
Her manual baseline is the monthly adoption scorecard: ~**3 engineer-days/month (~24h)** of grepping 200 repos for convention-plugin / shared-workflow / current-BOM adoption and hand-rolling a slide. Ascent must replace that with a re-pullable fleet read + movers + practice-library exemplar/gap in **well under an hour/cycle**. Target time-saved: **~20 hours/cycle** if the recurring read genuinely shows the standard landing fleet-wide. If she still has to grep the 200 repos herself because the fleet view can't tell her "the convention is on N repos now," the saving collapses to "a nicer chart," and at Enterprise that's a renewal she'd question on principle, not price.

## Senior-quality bar (reliability floor)
The recurring read must be at least as good as the adoption slide a senior platform lead would hand a VP: the JVM repos must be **read fairly** (build manifest detected, Spring/Gradle signals reflected — a confidently-low score because the scanner is TS-centric fails outright), the fleet move must be **legible across 200 repos** (not a 5-row teaser or an unsorted wall), and a reported move must be **distinguishable from re-scan noise**. A beautiful trajectory over a too-short window, movers that just restate the current number, or a Gradle repo scored as if it had no build all fail even if the page renders.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value:** this cycle surfaces *new, fleet-level* movement — "N repos on the standard / N moved, was M" — not a re-render of last cycle's average. (movers + period-summary + practices, against 200 repos.)
- [ ] **JVM stack-fit:** a Gradle/Kotlin/Spring repo's build manifest is actually sampled/read (`build.gradle`/`.kts`/`pom.xml`), so its score reconciles with the codebase and isn't depressed for being non-TS.
- [ ] **Repeatability:** re-scanning an unchanged JVM repo doesn't move the score outside the noise floor, and where a move shows, it's labelled real-vs-noise (trend confidence / flat-floor).
- [ ] **200-repo legibility:** she can see *which* repos moved this cycle without paging through an unsorted 200-row table or a top-5 teaser.
- [ ] **Price-legibility:** at Enterprise ("Custom — contact us") she can still map recurring value to her spend (usage/retention legible); the unseen subscription $ isn't a blocker at her tier but the *value* must be.

## Emotional baseline
Calm, exacting, low-drama. She doesn't bounce on friction the way a tire-kicker does — she's already paying — but she goes cold fast on a number she can't defend. Re-scan noise or a TS-centric misread doesn't make her angry; it makes her quietly stop trusting the tool and reach back for her spreadsheet. She warms only to specifics: a correctly-read Gradle plugin, a stable re-scan, a mover list that names the 12 repos that adopted the standard this month.
