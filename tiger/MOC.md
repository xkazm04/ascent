---
note_type: moc
title: Tiger — Map of Content
updated: 2026-06-20
tags: [moc, home]
---

# 🐅 Tiger vault — Map of Content

The home note. Open this folder as an Obsidian vault; start here. Tiger certifies the **highest-value part of this app — its LLM call sites** — across three lenses, and memorizes everything here so each run builds on the last. Engine skill: `.claude/skills/tiger.md`.

## The engine (memorized LLM call sites — "the kills")
- [[scan-assess]] — **the app's single LLM touchpoint**: the maturity assessor. `src/lib/scan.ts:206` → `provider.assess()`. Dials: wrapping 9/10 · observability 4/10 · caching 4/10 · grounding 5/5 (depth-capped).

## The three lenses
- [[engine-quality]] — Lens A: wrapping · observability · caching dials (static code audit).
- [[business-value]] — Lens B: UAT method scoped to the model output (per-Character senior-quality + grounding).
- [[model-optimization]] — Lens C: model × thinking frontier; cheapest config that holds every bar.

## Model frontier
- [[models]] — the benchmark matrix + dated price snapshot. The Lens-C plan.

## Characters
- [[_roster]] — the 10 Characters and their AI-surface angles (reused from `uat/characters/`).

## Sessions (memory — newest first)
- [[2026-06-20-tiger-benchmark]] — Lens-C **empirical** model-tier benchmark (haiku/sonnet/opus, real outputs, blind-judged). Confirms sonnet as the floor; haiku degrades on the un-guardbanded roadmap/discrepancy; opus is a premium ceiling.
- [[2026-06-20-tiger-l1]] — first run: L1 sweep, 10 Characters, all 3 lenses. Establishes the baseline dials + the predicted model frontier. P0-1/P0-2/P0-3 fixed since.

## Backlog
- [[backlog]] — the living, impact-ranked, cross-session backlog of engine improvements (the deliverable).

## How to read the trajectory
`/tiger recall` summarizes how the dials moved, what's open/regressed/closed, and the current model-fit decision. The point of a vault: run Tiger on a cadence and these dials become a story.
