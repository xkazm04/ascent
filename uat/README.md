# Simulated UAT — Character-driven acceptance (`uat/`)

This folder is **this repo's instantiation** of the simulated-UAT standard. It is driven by the `/uat` skill (`.claude/skills/uat.md`). The skill is the portable engine; everything here is repo-specific config.

The premise: instead of asserting that features are technically correct, we put **Characters** — durable, representative users with real jobs-to-be-done — through **journeys**, and have a capable LLM verify the journey *in-character* in two chronological certification levels: **L1 theoretical** (over a code-derived surface model — cheap, mass-parallel, no browser) then **L2 empirical** (the real app in a live browser — serial, long-running). It is automated **heuristic evaluation + cognitive walkthrough + jobs-to-be-done acceptance**.

> We say **Character**, never "Persona".

## What ascent is (so Characters stay grounded)

Ascent is **the maturity index for AI-native engineering**: point it at a GitHub repo (or a whole org) and it scores how deeply a team has adopted LLM-driven development — a **5-level ladder (L1 Manual → L5 Autonomous)** across **9 weighted dimensions** (AI Tooling & Conventions · Automated Testing · CI/CD & Delivery · Agentic Workflows · Documentation & Knowledge · Code Quality & Guardrails · Commit & Velocity Signals · AI Process & Harness · Supply Chain & Security), with the evidence behind every score, an adoption×rigor **posture quadrant**, and a prioritized roadmap. Free public single-repo scans (no signup) are the top of the funnel; the B2B layer is the **org-intelligence dashboards** under `/org/[slug]`. See `env.md` for surfaces + run recipe.

## Layout

| Path | What it is |
|------|------------|
| `characters/*.md` | Durable representative users (eng leaders + developers + an external buyer). The reusable IP. |
| `characters/retired/` | Characters whose job-to-be-done depended on a product surface that no longer exists. **Out of the roster** (`characters/*.md` doesn't match them) and never scored, but kept so their research and the runs citing them stay readable. See [`characters/retired/README.md`](characters/retired/README.md). |
| `journeys/*.md` | Goals (not scripts) with a user-POV definition-of-done. |
| `journeys/retired/` | Journeys whose definition-of-done depends on a removed surface. Out of the active set, kept as the acceptance bar to re-ground against if the surface returns. |
| `rubric.md` | The evaluation lens (7 dimensions) + severity scale + finding types. |
| `env.md` | How to reach a known, reproducible start state (the per-app file). |
| `accepted-gaps.md` | Baseline of known/accepted issues (suppressed in runs). |
| `driver/drive.mjs` | Portable browser driver (L2 only). |
| `runs/<date-slug>/` | Journals, screenshots, `findings.json`, `report.md`, per-Character feedback, `SUMMARY.md`. |

## Drain homes

`/uat drain` turns a run into a triaged design backlog, and the skill requires this section to exist
rather than be assumed — five runs before 2026-08-10 were never drained partly because this file
never said where the output goes.

| Artifact | Home |
|---|---|
| Analysis doc (the three sections) | `docs/product/uat-insights/<run-id>.md` |
| `build` items | [`docs/BACKLOG.md`](../docs/BACKLOG.md), under a per-run section, each citing its finding id and carrying a `standard:` line |
| `method-commitment` items | the same backlog section, as a standing rule **with a trigger** — never a ticket |
| Declines + guardrails | the same backlog section — a decline is recorded with its reason and a reopen condition so it can't resurface as a fresh idea |
| `concept-doc` items | [`docs/resolutions/`](../docs/resolutions/) — one file per design question, named for the question, extended rather than duplicated |

> The concept-doc home moved with the 2026-08-29 moonshot round: `docs/resolutions/` is where this
> repo's design questions live (`gate-as-code.md`, `open-benchmark-corpus.md`, …). A feature doc under
> `docs/features/<area>/` describes **implemented** product and is governed by the doc-sync hook in
> `AGENTS.md`; a drain's concept-doc describes something not yet built, so it does not belong there.

## Run it

```
/uat init        # scaffold/regenerate this overlay (does web research)
/uat update      # diff-aware refresh after the app changes
/uat run --l1    # cheap, broad, mass-parallel theoretical sweep across all Characters
/uat run         # full L1 → L2 on survivors
/uat run --surface /org/acme/delivery     # scope to one surface
/uat promote scan-a-public-repo           # freeze a clean journey into an acceptance gate
```

---

## Character template

```markdown
---
name: <First role-tag>
role: <real-world job title>
maps_to: <ascent surfaces/contexts this Character lives in>
tech_level: <novice | comfortable | power-user>
promotion: discovery
references:
  - <url> — <what bar it sets>
---

## Who they are
<1–3 sentences: company, seniority, what pressure they're under.>

## Background / lived experience
<The texture that makes feedback authentic: their history in the role, the tools
they've used and been burned by, who they answer to, what's personally at stake,
what a real day looks like. Richer background → more dimensions in their feedback.>

## Voice
<How they actually talk — register, idioms, what they'd say out loud — so their
first-person Character feedback sounds like THEM, not a report.>

## Jobs to be done
- <the job they "hire" ascent for, in their words>

## What "good" looks like (acceptance expectations)
<Externally grounded — cite the research. e.g. "expects the fleet maturity number
to reconcile with what they know about their teams within ~2 min, and to name the
single highest-leverage move — not a wall of metrics.">

## Pet peeves / friction triggers
- <what makes them bounce or distrust the product>

## Motivation — why use the app at all (time-saved)
<How long this assessment takes the traditional way (a hand-rolled maturity audit, a
DORA/DevEx spreadsheet, reading the repo themselves), and the time ascent must save.
If the app is slower or barely faster, that's a finding — they wouldn't adopt it.>

## Senior-quality bar (reliability floor)
<The score/roadmap/generated artifacts must be at least as good as this Character would
produce as a SENIOR in their role. e.g. "A staff engineer's read of the repo; a generic
'add more tests / improve CI' roadmap that ignores the cited evidence fails." Output a
senior would reject fails even if it 'worked'.>

## Scored acceptance criteria (judged identically every run)
- [ ] <explicit pass/fail check derived from JTBD + the two bars above>
- [ ] <…>

## Emotional baseline
<patience, skepticism, vocabulary — how they react to friction>
```

## Journey template

```markdown
---
character: <character name>
goal: <one line, in the Character's words>
promotion: discovery        # discovery | candidate | acceptance | retired
seed: <env preconditions / seed needed — e.g. ASCENT_AUTH_BYPASS=1 + seeded org, or just a public repo URL>
references:
  - <url> — <bar it sets>
---

## Trigger (why now)
<what makes the Character open ascent today>

## Definition of done (their POV)
- <observable outcomes that mean "I got my job done">

## Out of scope
- <explicitly NOT this journey, to avoid false "missing" flags>

## Discovery hints
Entry point(s): <route>. Do NOT script the steps — the Character finds
their own path; getting lost is itself a finding.

## Frozen happy path  (filled in only on `promote`)
<the stable step sequence + acceptance, once this graduates to a gate>
```
