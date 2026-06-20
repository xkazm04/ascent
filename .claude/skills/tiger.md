---
name: tiger
description: Goes for the throat of an LLM-powered app — its LLM call sites, the highest-value/highest-cost/highest-variance part — and certifies them across three lenses an ordinary test suite is blind to. (A) Engine quality of the integration code (wrapping, logging/observability, caching efficiency). (B) Business value of the model's output, using UAT's Character-driven L1 method but scoped ONLY to the LLM pieces (is the output senior-grade, grounded, trustworthy, worth the wait, per Character). (C) Model optimization as an alternative scenario — benchmarking the same Characters across different models × thinking levels to find the cheapest config that still clears every bar, and whether a premium config meaningfully upgrades value. Everything is memorized to an Obsidian vault (`tiger/`) so each run builds on the last — the vault IS cross-session memory. Stack-agnostic engine; per-app specifics live in the vault. Invoke with `/tiger init|run|benchmark|recall [args]`.
---

# Tiger — certify the LLM engine, the highest-value part of an AI app

In an LLM-powered product, the LLM call sites are the **vital organ**: they carry most of the value, most of the variable cost, and almost all of the output variance. A conventional test suite is structurally blind to whether they're *wrapped well*, *worth the money*, and *right-sized for the model*. Tiger hunts exactly those sites and judges them — nothing else. (UAT certifies the whole product journey; **Tiger drills into only the LLM pieces** and adds two LLM-native lenses UAT doesn't have: integration **code quality** and **model/cost optimization**.)

> Terminology shared with `/uat`: a **Character** is a durable, repo-committed representative user with goals, a senior-quality bar, and their own scored judgement. Tiger **reuses the UAT roster** (don't reinvent users) and re-scopes each Character to the *AI surface* — the part of the experience the model generates.

> Real model calls are the point of L2 (that's what makes business-value and the cost frontier real, not a thought experiment). So Tiger's live passes are a **deliberate periodic exercise, never a per-commit CI gate.** The two-level design keeps it affordable.

## The three lenses (Tiger's core)

Every finding is tagged with the `lens` it came from. The lenses are orthogonal — a call site can be beautifully wrapped (A) yet feed the model thin context (B) on an over-provisioned model (C).

### Lens A — Engine Quality (the integration code)
Audits the code *around* the model, not the model. **Fully static → pure L1** (no model calls). Score each sub-dimension as a **dial (`N/M`)** so it's a number you watch climb across runs, with `file:line` evidence:

- **Wrapping** — is the call defended? provider abstraction (swappable), **retry + failover** before a hard fail, **timeout + total budget**, **abort/cancellation** on client disconnect, **structured-output decoding** (schema-constrained request) + a **never-throw validator**, a **quality/coverage gate** (a parseable-but-empty reply must be treated as failure, not rendered as truth), **input/output bounds** (cap field length + array count so a hostile/verbose reply can't bloat the DB row, the payload, or the bill), and **graceful degradation** (a deterministic floor when the model is unavailable, flagged as such).
- **Logging / observability** — can you debug a bad answer and bill it honestly? **token-usage metering** (committed only on a *usable* attempt, never for a failed one), **latency**, **per-attempt outcome** logging, **prompt + raw-response capture** for post-hoc eval, a **request/trace id**, **cost attribution**, and **secret redaction** in logs (no API keys / PII in traces). The absence of prompt/response capture is usually the load-bearing observability gap — it blocks debugging, injection forensics, auditor defense, AND Lens-C benchmarking (no eval corpus) all at once.
- **Degrade-path disclosure parity** — when the model fails, the app falls back to a deterministic floor. Check that **every route to that floor discloses equally loudly.** The pilot found the *failure* route emits a loud "AI unavailable" caveat, but the *keyless-default* route (no key → mock from the start) sets the same floor with `degraded=false`, so it discloses only via a quiet chip. A floor served as "AI" without the loud caveat is a trust finding wherever any path reaches it silently.
- **Caching efficiency** — are you paying for the same tokens twice? **result caching** (by a stable key), **provider prompt-caching** (`cache_control` on the stable system/context prefix), **dedup** of identical in-flight calls, and **context-size discipline** (how much is re-sent every call vs. how much is truly per-request). Each gap carries a **cost implication**.

### Lens B — Business Value (UAT L1, scoped to the LLM output only)
The UAT method (Nielsen heuristics + cognitive walkthrough + JTBD), but the surface-binding is narrowed to **the part of the surface the model produces**. For each Character, walk the AI output theoretically and judge it through their lens:

- **Grounding audit (the L1 sweet spot)** — enumerate the Character's *real* context the output should use (their data, brand, costs, history, prior choices, the deterministic signals already computed) and score **how many actually reach the prompt** (`grounding N/M`). "Good machinery fed thin context" is the most common AI-product defect and is fully visible in code — make it a number per call site. Three refinements the pilot run proved sharpest:
  - **Audit BOTH directions.** *In:* does context reach the prompt? *Out:* does the model's provenance (engine, model, which fields it moved, degraded-or-not) survive into the **durable artifact** the Character actually files/exports/shares? A signed audit CSV that drops the engine column — so a deterministic-floor quarter is byte-identical to a model-scored one — is a grounding-OUT failure no prompt audit catches.
  - **The sharpest finding is "computed-but-not-wired".** Don't ask "does this context exist?" — ask "does context the app **already computed or already paid to fetch** actually reach the model?". The richest pilot findings were a stack detector whose result was dropped into `warnings` instead of the prompt, and a signal-ranked file fetch that got **re-sorted alphabetically** before the prompt window truncated it — both fully visible in code, both invisible to "does it exist?".
  - **Memory grounding.** On a *re-run* product, does the prompt carry "what changed since last time" / the Character's prior choices — or does it re-judge cold every call? (The vault itself is the model for what good cross-run memory looks like.)
- **Senior-quality bar** — is the model's output at least as good as this Character would produce as a senior in their role? Generic, ungrounded, or self-contradicting output fails even if it "worked".
- **Time-saved & trust** — does the AI output beat their manual way (a number), and would they stake their reputation on it (does it reconcile, is it sourced)?

L1 judges the *designed* prompt+grounding; **L2 confirms the live output actually uses the grounding** (names the supplied entity, reflects the real data).

### Lens C — Model Optimization (the alternative-scenario lens — Tiger's novel contribution)
Treat **model × thinking-level** as a *variable*, not a constant. Ask, per LLM piece:

> *What is the cheapest model/thinking config that still clears every Character's senior-quality bar — and does a premium config meaningfully upgrade business value, or just cost more?*

- **L1 (theoretical frontier).** From task shape (is it grounded? structured-output? reasoning-heavy or extraction-heavy?), the quality bar, and the **price table** (`models.md`), predict a quality↔cost frontier and place the **current default** on it: over-provisioned (paying for reasoning the task doesn't need), right-sized, or under-provisioned (a cheaper model is failing skeptical Characters). Output a **benchmark matrix** (which models × thinking levels are worth testing live) and *predicted* winners.
- **L2 (empirical benchmark — `benchmark` mode).** Actually run the LLM piece with each config against fixed Character inputs; have the Characters score the outputs; plot the **real** frontier (quality delta vs cost delta per config). The deliverable is a **model-fit recommendation per piece** with a concrete monthly-cost delta — the single most actionable thing Tiger produces for "improving the engine."

Rules the pilot + the first live benchmark proved:
- **Decompose the piece before you price it — the "two-model split".** A single call site often mixes a *bounded* sub-task (extraction, or a score the engine clamps/guardbands so the model can barely move it) with an *unbounded* sub-task (a reasoning-heavy roadmap or audit). The bounded part is model-INsensitive (a cheap model holds it); the unbounded part sets the quality floor. A **split** *can* win — cheap model for the bounded part, strong only for the reasoning. But **price the split against the token mix**: if OUTPUT tokens dominate the bill (they usually do), an input-side or scoring-side split saves little, and the cheap model often degrades the *prose* too — so a single mid model frequently beats the split. The pilot benchmark found exactly this; don't assume the split wins, measure it.
- **A downstream clamp protects the NUMBER, not the OUTPUT — benchmark the un-clamped sub-tasks.** When a guardband/clamp sits after the model, a cheap model's wild score gets clipped back into range, so the *final number* looks fine — but the **un-clamped** qualitative output (roadmap, audit, summaries) is where the cheap model visibly degrades, and skeptical Characters catch it blind. So "the cheap model holds the score" is usually *true and irrelevant*: the score was never the value. Design the benchmark fixture to **stress the un-clamped sub-tasks** (e.g. plant a detector miss the audit must catch) and judge those, not the clamped number.
- **Configured ≠ realized.** When a guardband/clamp/blend sits downstream of the model, compute the **realized** effect, not the configured constant — a "±25 guardband" blended 60/40 means the model can only move the final number ±15. Price and judge the *realized* swing, or you'll over-state how much a better model can even buy.
- **Judge blind, with the must-pass panel.** Anonymize the per-tier outputs (A/B/C, mapping withheld) and have 2-3 must-pass Characters score them — independent blind convergence (both judges ranked opus>sonnet>haiku without knowing the tiers) is far stronger evidence than one labelled comparison.

## The Obsidian vault — `tiger/` (this IS the memory)

Per-app specifics live in an **Obsidian vault** committed at `tiger/`. It's a real vault (YAML frontmatter + `[[wikilinks]]` + a Map-of-Content home note) so a human can open it in Obsidian and *navigate the LLM engine's history*, and so each run **follows and extends the last** instead of starting cold.

```
tiger/                         # open THIS folder as an Obsidian vault
  README.md                    # what this is, how to run, the engine summary
  MOC.md                       # Map of Content — the home note; links every engine/character/session/backlog note
  engine/                      # THE memorized LLM-usage map — one atomic note per call site ("the kills")
    <call-site>.md             # frontmatter {file,line,task,provider,model,grounding,lenses}; body: 3-lens audit + [[links]]
  lenses/
    engine-quality.md          # Lens A rubric (the wrapping/logging/caching dials)
    business-value.md          # Lens B rubric (inherits uat/rubric.md dimensions, LLM-scoped)
    model-optimization.md      # Lens C rubric + how to read the frontier
  models.md                    # the model × thinking-level benchmark matrix + a dated price-table snapshot
  characters/
    _roster.md                 # which UAT Characters this vault uses + each one's AI-surface ANGLE (cost/trust/privacy/grounding)
    <slug>.md                  # only for Characters NOT already in uat/characters/ (else [[link]] to the UAT file)
  sessions/                    # session memory — one dated note per run (Obsidian daily-note style)
    <YYYY-MM-DD-slug>.md       # journal: surface diff vs last session, lens scores, links to new/closed findings
  backlog.md                   # the LIVING cross-session backlog (the deliverable); open items roll forward, closed ones move to a log
  findings/                    # optional atomic note per significant finding, linked from backlog + engine + session
  .gitignore                   # ignore any large raw benchmark transcripts (keep the scored summaries)
```

**Continuity contract (every `run`):** (1) read the latest `sessions/*.md` + `backlog.md` + `engine/*.md` to load prior state; (2) re-discover LLM call sites and **diff** against `engine/*` (new / changed / removed); (3) run the lenses; (4) write a new `sessions/<date>.md` capturing the **delta** (which dials moved, which findings closed/opened, which model-fit decisions changed), update the affected `engine/*` notes, and roll `backlog.md` forward. A dial that moved run-over-run is the headline; a finding that reappears after being marked closed is a **regression**. The vault makes both visible without re-deriving from scratch.

## Two-level certification (chronological, inherited from `/uat`)

- **L1 — theoretical (static, code-grounded, mass-parallel).** Build the LLM surface model from code, run all three lenses *on paper*. Lens A is **fully** L1. Lens B is UAT-L1 scoped to the AI output. Lens C-L1 is the predicted frontier + benchmark plan. **No model calls.** Cheap and parallel — dispatch one subagent per Character. **Pass → L1.**
- **L2 — empirical (live model calls, serial).** Only for what earned L1. Run the actual LLM piece. Lens B-L2 = real output quality per Character on the *grounded* path. Lens C-L2 = the real model×thinking benchmark (`benchmark` mode). Long and env-gated by nature — accept it.

Why chronological: L1 is a cheap filter and the only level that scales Characters to 10+ for free; reserve expensive serial L2 (real tokens, real latency, real spend) for the questions L1 raised. A Lens-A finding needs no model call at all — it's `file:line` truth.

## Finding schema

Extends the UAT finding with `lens` and the Lens-C model fields:

`{ id, lens, call_site, character?, cert_level, type, severity, impact, dimension, title, expected, got, evidence[], code_check, verdict, cost_note?, model_variant?, quality_delta?, cost_delta?, resolution, ceiling, l2_priority? }`
- `lens`: `engine-quality | business-value | model-optimization`
- `call_site`: the `engine/<note>` this is about (the LLM touchpoint) — REQUIRED, so every finding links to a memorized site.
- `character`: required for Lens B/C findings (whose bar), omitted for pure Lens-A code findings.
- `cert_level` `L1|L2`; `type` `missing-feature|quality-gap|broken-flow|confusion|trust|cost`; `dimension` adds `cost` and `observability` to UAT's seven.
- `severity` derived from `impact` `{frequency, reachability, trust_erosion}` — **don't free-hand it.** For Lens A/C, `frequency` ≈ how many calls/$ it affects (a per-call waste outranks a rare edge case).
- `evidence[]`: `file:line` at L1; transcript/score at L2. `code_check`: `confirmed-absent|present-but-missed|present-broken|by-design|n-a`. `verdict`: `confirmed|refuted|uncertain` (adversarial). `resolution`: `open|fixed|resolved-verified|by-design|accepted`. `ceiling` required on every `resolved-verified`/`by-design`.
- Lens C only: `model_variant` (e.g. `haiku · think:low`), `quality_delta` (vs the default, per the Character panel), `cost_delta` (per-call or per-month $).
- A finding may be a **strength** (e.g. "usage committed only on a usable attempt — honest billing") — strengths say what NOT to touch.

---

## Mode: `init`

Goal: scaffold the `tiger/` vault grounded in the codebase's **actual LLM surface**.

1. **Discover the LLM call sites (stack-agnostic).** Grep for provider SDKs and call shapes: `openai`, `anthropic`/`@anthropic-ai`, `@google/genai`/`generativelanguage`, `@aws-sdk/client-bedrock`, `langchain`, `vercel ai` (`ai` pkg / `generateText`/`generateObject`), `ollama`, `mistral`, plus a local provider abstraction (`assess(`, `complete(`, `chat(`, `generateStructured(`). **Follow the import chain** from each call to the code that builds its prompt and decodes its response — don't guess the file. Each distinct touchpoint → one `engine/<call-site>.md` note.
2. **For each call site, capture (in its note):** the *task* (what the model is asked to do), the *prompt construction* + what **grounding** reaches it (`grounding N/M`), the *structured-output* contract (schema? validator?), the *provider/model* + how it's selected, and the **wrapping/logging/caching** machinery present → the Lens-A dials. Cite `file:line` for everything.
3. **Bind Characters.** Reuse `uat/characters/*` if a UAT overlay exists (it usually does — `/tiger` and `/uat` are siblings). In `characters/_roster.md`, list the chosen Characters and give each an **AI-surface angle** — the dimension of the *model output* they judge hardest (grounding, hallucination, trust/defensibility, latency, **cost**, **model privacy/on-prem**, **determinism**). Pick a roster that spans all three lenses (you need cost- and model-savvy Characters for Lens C, a security Character for Lens A, skeptics for Lens B). If no UAT roster exists, derive Characters from the app's target group exactly as `/uat init` does.
4. **Write the lenses + the model matrix.** `lenses/*.md` (engine-quality dials, business-value = link to `uat/rubric.md` + the LLM scope, model-optimization frontier method). `models.md`: the candidate **models × thinking levels** to benchmark, with a **dated snapshot of the app's own price basis** (find the price table / cost config in code) so the cost frontier is grounded in real rates, not guesses.
5. **Write `MOC.md` + `README.md`.** The MOC links every note so the vault is navigable in Obsidian from one home note.

Output: a short summary of the LLM surface found + the Lens-A dials' starting values. Do not run Characters in `init`.

## Mode: `run`  (default L1; `--l2` adds the live pass)

Certify the LLM surface across the three lenses. Honor the **continuity contract** (read prior sessions first; diff the surface; write a session note + roll the backlog).

### Phase L1 — theoretical (mass-parallel)
- **Lens A (code audit) — one focused pass (you, or 1–3 subagents for a large surface).** Walk each `engine/*` note's machinery and score the wrapping/logging/caching dials with fresh `file:line`. Emit Lens-A findings (no Character needed). This is pure code truth.
- **Lens B (Character value) — dispatch one subagent per Character.** Each reads its bound call sites, builds the AI-output surface model, runs the grounding audit, and walks the output in-character against their scored criteria (senior-quality, time-saved, trust) — **scoped to the model output only**. Returns a per-Character value verdict + grounding score + findings.
- **Lens C (model frontier) — one subagent (or fold into the Lens-B agents' "would a cheaper/bigger model change your verdict?" question).** Produce the predicted frontier per call site, place the current default, and emit the **benchmark matrix** for `benchmark` mode to run live.
- **Synthesize.** A final pass writes the session note + updates `backlog.md`: the **impact-ranked backlog** across all three lenses, the **dial deltas** vs the prior session, and the **model-fit recommendation (predicted)**.

### Phase L2 — empirical (serial, live; `--l2`)
Only the questions L1 raised. For **Lens B**: run the real LLM piece against each Character's grounded inputs and assert the live output *uses* the grounding + clears the bar (real quality, latency, determinism on a re-run). For **Lens C**: see `benchmark`. Adversarially verify every kept finding (a refuter pass — "is the slow call a timeout or just slow?"; "did the cheaper model actually fail, or did the judge over-penalize?"). Only `confirmed` reach the headline.

## Mode: `benchmark`  (Lens C empirical — the live model × thinking sweep)

The expensive, highest-value pass: run the LLM piece across the `models.md` matrix against **fixed Character inputs**, score each output with the **Character panel** (the same scored criteria, applied identically), and plot the **real quality↔cost frontier**.
1. **Hold the input fixed** (same repo/prompt/grounding across all variants) so the only variable is model × thinking. Capture token usage + latency + the raw output per variant (raw transcripts gitignored; scored summaries committed).
2. **Score each variant** with 2–3 Character judges (multi-sample; take the majority) against their senior-quality bar → a `quality_delta` vs the current default. Price each with `models.md` → a `cost_delta` (per-call and projected per-month at the app's real call volume if known).
3. **Recommend per call site:** the cheapest config that holds every must-pass Character's bar (the floor), and whether any premium config buys enough value to justify its delta (the ceiling). Write `sessions/<date>-benchmark.md` + update the call site's `engine/*` note's `model:` decision and the backlog.
4. **Honesty:** if the env can't run live model calls (no key / local-only provider / sandboxed), say so and emit the **plan + predicted frontier** instead of fabricating numbers — exactly like a UAT L2 that's env-blocked. A predicted frontier clearly labelled "theoretical" beats invented benchmarks.

## Mode: `recall`  (memory readout — no new scan)

Read the vault's `sessions/*` + `backlog.md` + `engine/*` and report the **trajectory**: how each Lens-A dial moved over time, which findings are still open / regressed / closed, the current model-fit decision per call site and when it last changed, and the top of the backlog. This is the "what has Tiger learned about this engine" view — the payoff of memorizing to a vault.

---

## Concurrency model
- **L1 is mass-parallel** — dispatch one subagent per Character (Lens B) at once; Lens A is a small static pass. A 10-Character L1 sweep finishes in ~one agent's wall-clock.
- **L2 / `benchmark` is serial with long runs** — real model calls take 30–130s each and the matrix multiplies them; queue them, accept the wall-clock, and **budget for latency**.
- **Artifact hygiene:** gitignore raw benchmark transcripts (`tiger/sessions/*/raw/`); commit the scored summaries + the vault notes. If another agent commits in the same tree, commit vault artifacts path-scoped in a quiet window.

## Trust rules
- **Grounding:** no finding without evidence (L1 → `file:line`; L2 → transcript/score). Never fabricate a benchmark number — env-blocked → predicted frontier, labelled.
- **Per-character consistency:** judge against each Character's *scored criteria*, identically each run; multi-sample Lens-C judging across 2–3 samples and take the majority.
- **Impact over label:** rank the backlog by `impact` (frequency × reachability × trust-erosion / cost), not the raw severity word — a per-call token waste or an every-scan ungrounded field outranks a rare edge case.
- **Honest ceilings:** every `resolved-verified`/`by-design` finding names the limit that remains.
- **Lens separation:** never let a gorgeous Lens-A wrapper excuse a Lens-B grounding gap, or a great Lens-B output hide that it's running on a 3×-too-expensive model (Lens C). The three verdicts are independent.

## Using this on a new app
1. Drop `/tiger` into the repo (`.claude/skills/tiger.md` — a portable, copy-to-other-repos asset, like `/uat`). 2. `/tiger init` → discovers the LLM call sites, scaffolds the `tiger/` vault, reuses the UAT roster (or derives one). 3. `/tiger run` → cheap L1 sweep across all three lenses → a session note + an impact-ranked backlog + a predicted model frontier. 4. Fix the Lens-A/B items; **`/tiger benchmark`** when you want the real cost frontier. 5. `/tiger recall` any time to see the engine's trajectory. The vault carries the memory forward — run it on a cadence and the dials become a story.
