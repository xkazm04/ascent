# L2 control arm — does the LLM actually move the score, or echo the detector?

**Claim under test (the product's own, `README.md:34`):** *"`GEMINI_API_KEY` → **Live mode** — Gemini
calibrates the signal scores and writes the roadmap."* And `README.md:83-85`: the LLM's
per-dimension score is guardbanded (±25) to the signal score, then blended 60% LLM / 40%
deterministic.

v1.2 makes control arms routine: *for any claim of the form "the output used input X", re-run
with X removed.* Here the arm is free — the app **ships both arms inside every response**:
`signalScore` (deterministic detector, no LLM) and `llmScore` (the model's own number) are both
persisted per dimension alongside the `score` that is actually shown.

## Measurement — real `claude-cli` / `sonnet` scan of `vercel/swr` (193 s)
Source: `_l2-warm-scan-swr.json`.

| Dim | signalScore | llmScore | blended (shown) | Δ (llm − signal) |
|---|---|---|---|---|
| D1 AI Tooling | 0 | 6 | 3 | **+6** |
| D2 Testing | 100 | 97 | 98 | −3 |
| D3 CI/CD | 75 | 77 | 76 | +2 |
| D4 Agentic | 0 | 5 | 3 | **+5** |
| D5 Docs | 45 | 48 | 47 | +3 |
| D6 Code Quality | 75 | 75 | 75 | **0** |
| D7 Commit/Velocity | 80 | 78 | 79 | −2 |
| D8 AI Process | 21 | 22 | 22 | +1 |
| D9 Supply Chain | 40 | 40 | 40 | **0** |

`scoreIntegrity: {"d9Unmeasurable":false,"widenedDims":["D3"],"effectiveBlend":0.51}` · `confidence: 0.85` · `archetype: "org"`

## Result — a split verdict, and the split is the finding

**The LLM moved off the deterministic floor in 7 of 9 dimensions — but never by more than 6
points, and by ≤3 points in 5 of them.** The guardband allows ±25; the model used at most 24% of
it. Two dimensions (D6, D9) came back byte-identical to the detector. Net effect of a 193-second
Claude call on the headline number: **roughly ±2 points on a 0–100 scale.**

So the README's two claims do **not** hold equally:

- ❌ *"calibrates the signal scores"* — **weakly supported.** On this repo the LLM is very nearly
  a no-op on the numbers. A user who paid 193 s (or, in production, real tokens) for
  "calibration" got a result within rounding distance of the free deterministic path.
- ✅ *"writes the roadmap"* — **strongly supported, and this is where the value actually is.**
  The roadmap items are specific and repo-grounded in a way no template could be: *"0 of 8 Action
  references are pinned to a SHA"*, *"only 56% of sampled merged PRs carry an approving review —
  that gap (likely maintainer self-merges or an admin bypass) is worth understanding"*. The two
  `discrepancies` are sharper still — the model caught that the D9 "Signed releases 0/10"
  detector result is a **false negative**, because `trigger-release.yml` sets
  `permissions: id-token: write` and installs npm ≥11.5.1 for OIDC trusted publishing, which does
  produce Sigstore provenance. **That is the detector being corrected by the model — genuine
  senior-grade work, and it is surfaced honestly to the user rather than hidden.**

## Why this matters for the Characters
- **Sam** (senior-quality bar): the *explanation* clears his bar; the *number* is one he could
  have gotten free. His "is this better than my own read" question resolves in favour of the
  prose, not the score.
- **Tomáš** (time-saved, 2–3 min budget): 193 s of his 180 s budget buys ±2 points of score
  precision plus a genuinely good roadmap. Whether that is worth it depends entirely on whether
  the UI tells him the roadmap is the product and the number is the hook.

## Second control arm — a source the model provably never saw
`TECH_STACK_PROMPT` is unset on this host, so `techStackPromptEnabled()` is `false`
(`src/lib/llm/config.ts:106-109`) and source #7 never enters the prompt
(`src/lib/scan-score-input.ts:118`). Yet the response carries
`techStack: {"languages":["TypeScript"],"frameworks":["React"],"roles":["frontend"],"confidence":0.53}`.

**Confirmed: the report displays a detected tech stack that the scoring model never received.**
This is display-only enrichment (deliberate — the gate's own comment at `config.ts:100-105` says
it is held back so prompt changes don't move calibrated scores). It is defensible engineering,
but it is invisible to the user: nothing on the report distinguishes "the model considered this"
from "we detected this separately". Same class applies to `contributors` / `aiChanges`, both
resolved for the report only (`src/lib/scan.ts:280-281`), never for the prompt.

**Evidence:** `_l2-warm-scan-swr.json` · `src/lib/llm/config.ts:106-109` ·
`src/lib/scan-score-input.ts:118` · `src/lib/scan.ts:280-281` · `src/lib/scoring/prompt.ts:186`.
