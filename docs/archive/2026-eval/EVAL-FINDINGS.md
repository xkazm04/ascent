# Eval findings — xkazm04 portfolio (2026-05-29)

20 owned repos scanned live via `claude-cli` (Sonnet). Full data:
`bench/results/xkazm04.json`. This is a single-author, mostly-TypeScript, mostly-young
portfolio — a deliberate stress test of the model's calibration.

## Distribution

| Level | Count | Repos |
|---|---|---|
| L4 | 1 | personas |
| L3 | 3 | medcat, vibeman, pof |
| **L2** | **13** | all 7 `xprize-*`, personas-web, studio-story, creator, auto-invoicer, kp, goat |
| L1 | 3 | pof-exp, care, personas-cloud |

Per-dimension mean: **D1 29 · D2 53 · D3 14 · D4 10 · D5 48 · D6 43 · D7 87.**

## Headline: detectors are accurate; this is a *calibration + framing* problem

Ground-truthed against the GitHub tree:
- `xprize-*` D1=0 / D3=0 are **correct** — those repos have **no** committed
  CLAUDE.md/AGENTS.md/.cursor and **no** workflows. Not a detector miss.
- `care` D2=0 is **correct** — no test files exist.
- `personas` D1=70 correctly found `.claude/CLAUDE.md` + nested `src/features/agents/AGENTS.md`.
- D6's flat "40" = `eslint + tsconfig strict` (the universal TS baseline). Accurate.

So the low scores are *true*. The findings below are about what we measure and how we
weight it for this population — not bug-fixes.

## Findings

1. **Score compression — 13/20 land in L2.** The model is effectively using ~2 of its 5
   levels for a solo/prototype population. Cause: high-weight dimensions that *flatline*
   for solo work — **D3 (CI/CD) mean 14, D4 (Agentic) mean 10** — combine for 32% of the
   score and are ~0 on most repos. The discriminating axes are **D1 (0–70), D2 (0–90),
   D6 (0–65), D5**.

2. **D7 (Commit signals) is saturated at 87 mean / mostly 100.** Every repo maxes it
   (AI co-author trailers + conventional commits + recent activity). It confirms "AI was
   used" but adds ~no discrimination of *maturity*.

3. **"AI-built" ≠ "AI-native maturity."** The `xprize-*` apps are obviously AI-generated
   (D7=100, templated, fast) yet score L2 because they ship **no committed guardrails**
   (no tests-in-CI, no agent guidance, no automation). The model correctly measures
   *"is this engineered so AI can ship safely/repeatably?"* — but users may read a low
   score as "not built with AI," which is the opposite of the truth here.

4. **The LLM is a calibrated explainer, not an independent grader.** With the prompt's
   "calibrate to the signal scores" instruction + ±25 guardband, raw LLM scores sit
   within 20 of signals on every dimension/repo here. Reproducible and cheap — but it
   means the LLM rarely *catches detector gaps* (e.g. the earlier slugify root-`test.js`
   miss). Lever available if we want more LLM signal.

## Proposals (see chat brainstorm for discussion)

- **A. Repo-archetype "lens" (highest impact).** Infer solo/prototype vs team/product vs
  org/platform from signals (contributors, stars, size, CI presence) and re-weight:
  for solo/early repos, down-weight D3/D4 (org-scale), up-weight D1/D2/D5/D6. Fairer +
  de-compresses the range. Config in `src/lib/maturity/model.ts`.
- **B. Two-axis framing: "AI Adoption" × "Engineering Rigor".** Adoption = D1+D4+D7;
  Rigor = D2+D3+D5+D6. AI-native = high on *both*. Explains the data (xprize = high
  adoption / low rigor = "fast but ungoverned") and is a stronger product story than one
  scalar. Overall level ≈ how balanced + high both axes are.
- **C. Redesign D7.** Split "AI usage detected" (a badge/indicator, not a weighted score)
  from "process hygiene" (conventional-commit %, small-batch cadence). Stops saturation.
- **D. LLM as auditor (optional).** Add a "discrepancies" output where the model flags
  signals it believes are wrong (detector misses) — feeds the detector backlog; keep the
  deterministic score authoritative.
- **E. Re-band** only if A/B don't spread the range enough.
