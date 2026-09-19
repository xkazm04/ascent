# Tiger L1 sweep brief — 2026-06-20 (theoretical / code-grounded, NO model calls, NO browser)

You are running **Tiger L1 certification** for ONE Character against the app's single LLM call site, **[[scan-assess]]** — the maturity assessor (`src/lib/scan.ts:206` → `provider.assess()`; prompt at `src/lib/scoring/prompt.ts`). This is a thought experiment over a code-grounded model of **what the LLM produces**. **Do not run the app, a browser, or any model call.** You read code, inherit the engine note, judge in-character, and write.

Tiger judges the **highest-value part of an LLM app — its LLM pieces — across three lenses**. You judge primarily through YOUR angle (given in your task), but answer the one-line Lens-C question regardless.

## The question you answer, in-character
**"Is the model's OUTPUT — the per-dimension score nuance + summaries/strengths/gaps + the headline + the invitational roadmap + the discrepancy audit — senior-grade, grounded, and trustworthy enough for MY job? And from my angle, what is the single highest-value change to this LLM engine?"**

## What the LLM actually produces here (read [[scan-assess]] first, then spot-check)
- Schema-constrained JSON: 9 dimension scores **calibrated to deterministic signalScores**, summaries, strengths, gaps; headline; org strengths/risks; a 3-5 item **invitational roadmap**; a **discrepancies** auditor pass. Prompt: `src/lib/scoring/prompt.ts:101-151`; system `:46`.
- **Load-bearing constraint:** the score is *guardbanded* — the model nuances within a small band, the engine clamps the LLM ±25 and blends 60/40 (`src/lib/scoring/engine.ts`). So **scoring is nearly model-insensitive**; the model's unbounded value is the **roadmap** and the **discrepancy audit** (reasoning over file excerpts). Keep this in mind for senior-quality AND for the Lens-C question.
- **Grounding reaching the prompt (`5/5` sources, depth-capped):** repo-meta, all 9 deterministic signals + evidence, process/PR/governance signals (token-gated), 15 commit messages, and file excerpts capped at **2200 chars/file, 22000 total** (`prompt.ts:87-95`) — a large repo is judged on ~10 excerpts. There is **no memory** of prior scans in the prompt.

## Method (in order)
1. **Inherit [[scan-assess]]; spot-check YOUR angle for fresh `file:line`.** Don't re-audit the whole engine — open the 1-3 files most load-bearing for your angle (e.g. a cost angle → `src/lib/llm/config.ts` prices + `prompt.ts` token weight + the missing prompt-cache; a security angle → `prompt.ts` file-injection surface + `scan.ts:281` logging; a determinism angle → `engine.ts` guardband + re-scan noise; a model-choice angle → `src/lib/llm/index.ts` selection + `bedrock.ts` structured output). Cite fresh `file:line`. Keep three verdicts distinct: **exists in code ≠ reaches the model output ≠ clears MY bar.**
2. **Grounding audit (Lens B), scored `N/M`.** Does the output use the context YOUR Character would demand? You know what a senior in your role expects to see cited. Score it and name what's missing.
3. **Senior-quality + trust judgement.** Apply your character file's **scored acceptance criteria**, **Motivation (time-saved, as a NUMBER)**, and **Senior-quality bar** — but only to the **model-produced output**, not the surrounding UI. Would you stake your name on this number / paste this badge / run this roadmap? Is the discrepancy audit something you'd trust?
4. **Lens-C question (always answer):** *Would a CHEAPER model (gpt-4o-mini / gemini-flash / haiku) still clear your bar on this output — or does the roadmap/discrepancy quality require sonnet+/opus/thinking? Would a PREMIUM model change your verdict?* Given scoring is guardbanded, be specific about WHICH part (score vs roadmap vs discrepancies) would degrade or upgrade. See [[models]] for prices.

## Finding schema (one object per finding; strengths allowed)
`{ id, lens, call_site:"scan-assess", character, cert_level:"L1", type, severity, impact, dimension, title, expected, got, evidence[], code_check, verdict, model_variant?, quality_delta?, cost_delta?, l2_priority? }`
- `lens`: engine-quality | business-value | model-optimization
- `type`: missing-feature | quality-gap | broken-flow | confusion | trust | cost
- `dimension`: completion | effort | clarity | trust | missing | time-saved | senior-quality | cost | observability
- `severity`: blocker | major | minor | polish — **derive from `impact`, don't free-hand.**
- `impact`: `{frequency, reachability, trust_erosion}` each low|med|high (frequency ≈ how often/how-many-calls-or-$ it hits).
- `evidence[]`: `file:line` REQUIRED at L1. `code_check`: confirmed-absent | present-but-missed | present-broken | by-design | n-a.
- `verdict`: confirmed | refuted | uncertain (adversarial — default refuted/uncertain unless the `file:line` holds).
- Lens-C findings: include `model_variant`, predicted `quality_delta` (vs sonnet default), `cost_delta` (per [[models]]).
- `l2_priority`: what a live model call must confirm (e.g. "run haiku on a real repo — does the roadmap go generic?", "re-scan an unchanged repo twice — does the score wobble in the guardband and is it surfaced?").

## What to WRITE — one file
`tiger/sessions/2026-06-20-tiger-l1/<slug>.md` (slug in your task) with:
- `# Tiger L1 — <Character> × scan-assess` + a one-line verdict.
- **Angle & reachable output:** what part of the model output you judged (tier-honest — e.g. a Free-tier OSS Character gets the public scan; note if the mock floor, not a real model, is what they'd actually see).
- **Surface-model notes:** the output affordances → fresh `file:line` for your angle.
- **Findings:** a fenced ```json array (schema above; include strengths).
- **Lens-C answer:** cheaper-holds / needs-mid / premium-helps, naming the part (score vs roadmap vs discrepancies) + a rough `cost_delta`.
- **Character feedback (first-person, in their VOICE):** would I trust this number · would I paste the badge · is the roadmap one I'd run · is it worth the wait/cost · what's the ONE engine change I want · would I tell a peer.
- The **grounding score (N/M)**, **per-use time-saved (number)**, and a one-line **engine verdict** (ship-as-is / fix-then-ship / not-yet).

## What to RETURN to the orchestrator (short)
`VERDICT: senior-grade | fix-first | not-yet` · `LENS-C: cheaper-holds | mid-floor | premium-helps` (one phrase) · counts by severity · grounding (N/M) · the single sharpest finding (title + lens) · a one-sentence Character verdict in their voice · top `l2_priority`.
