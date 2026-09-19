# Ascent: scoring calibration

A small labeled benchmark + a harness to measure how well Ascent's levels match human
judgment, so the rubric (weights/thresholds) can be tuned with evidence instead of
guesswork. Backlog items **I1** (labeled set) and **I2** (agreement harness).

## Why

The maturity score must be *credible*. The harness runs a fixed set of repos through the
scanner in **mock mode** (deterministic, signal-only, no LLM variance, no API key) and
reports agreement with hand-assigned expected levels, plus the per-dimension score
distribution. This isolates and validates the **deterministic backbone**; the live LLM
layer adds nuance on top of it.

## Run it

```bash
npm run dev            # terminal 1 (or `npm run build && npm run start`)
npm run bench          # terminal 2 — targets http://localhost:3000
BENCH_URL=https://your-deploy.vercel.app npm run bench
npm run bench -- --strict   # exit 1 if within-1-level agreement < 80% (CI gate)
```

Each repo costs ~3 GitHub API calls; the default 20-repo set stays under the
unauthenticated 60/hr limit. Set `GITHUB_TOKEN` to be safe.

## What it reports

- **Exact level** agreement and **within-1-level** agreement (the ordinal-friendly metric:
  being one band off is a near-miss, not a failure).
- **Mean |level Δ|**.
- **Per-dimension mean score**: a quick health check that no dimension is stuck at 0/100
  (a sign of a broken detector or a mis-weighted axis).

## The labeled set

[`bench/repos.json`](../bench/repos.json): `{ repo, expected, note }`. The expected
levels are **provisional hand estimates**; curate and expand them as you build consensus
(aim for a spread across L1–L5 and ~20–30 repos for a stable signal). Disagreement is the
*input* to calibration, not a bug.

## D9 (Supply Chain & Security) and the limits of a file scan

D9 was added in the 8→9 rubric revision and validated against the labeled set in mock mode:
within-1-level agreement stayed at **100%** and D9 discriminates cleanly across the set
(`0` for repos with no committed security tooling → `~26` for SCA + policy → `60–69` for
full supply-chain posture, anchored by `sigstore/cosign` and `aquasecurity/trivy`).

**Known limitation (narrowed in r7): D9 sees security committed as code, plus what a token
scan can observe on GitHub's side.** The mock/anonymous path is still file-only, so a repo can
score `D9 = 0` there while being well-secured in practice. Two postures used to be invisible
to any scan; both now have a token-gated, additive read:
- **GitHub "default-setup" CodeQL** is configured in repo settings and leaves no workflow
  file. Since r7 the D9 battery reads the **installed-App inventory** from the scored commit's
  check suites (`src/lib/github/check-suites.ts`): a `github-code-scanning` suite scores the
  SAST check 10 with or without a workflow, and a supply-chain App (Socket/Snyk/Wiz/…) lifts
  dependency-updates to 6 when nothing is committed. Only credited when the App actually
  posted a suite on that commit; a null inventory leaves the score byte-identical.
- **Org-level security policy** (a `SECURITY.md` in the org's `.github` repo) is read by
  `src/lib/github/security-posture.ts` and credits the security-policy check (8); an
  org-level `dependabot.yml` is still inferred behaviourally from bot commits (8), not read.

The mock-mode figures above are unchanged (`pallets/flask` and `vercel/next.js` still score
`D9 = 0` without a token, verified: no repo-level `dependabot.yml` / `SECURITY.md` /
`renovate.json`; `facebook/react`, which commits both, scores `26`), and D9 is still
**deliberately not** inflated to compensate for what no source can observe. The signal layer
is regression-guarded by [`src/lib/analyze/calibration.test.ts`](../src/lib/analyze/calibration.test.ts)
(no inventory) and by the byte-identical pins in `src/lib/security/checks.test.ts` (null
inventory ≡ pre-r7).

## Live eval with the Claude CLI (subscription)

Mock mode validates the deterministic backbone. To evaluate the **real LLM output** at
scale without burning API credits, run the server with the **`claude-cli` provider**,
which shells out to your locally installed `claude` CLI under your Pro/Max subscription
(the Agent SDK only supports API keys, so we spawn the CLI; no Rust needed).

```bash
# 1. Make sure the CLI is logged in (subscription) and no API key is set:
claude /login          # once, interactive   ·   (ensure ANTHROPIC_API_KEY is UNSET)

# 2. Run the server with the CLI provider:
LLM_PROVIDER=claude-cli npm run start        # or npm run dev

# 3. Eval live and save the run:
npm run bench -- --live --save
```

Config: `CLAUDE_MODEL` (default `sonnet`; or `opus` / a pinned id), `CLAUDE_CLI_PATH`,
`CLAUDE_CLI_TIMEOUT_MS`. For non-interactive/CI subscription auth, generate a one-year
token with `claude setup-token` and set `CLAUDE_CODE_OAUTH_TOKEN`.

### Measuring improvement across changes

`--save` writes each run to `bench/results/<engine>-<timestamp>.json` (git-ignored).
Diff two runs to see whether a prompt/rubric change actually improved agreement:

```bash
npm run bench -- --live --save        # run A (baseline)
# …change the prompt in src/lib/scoring/prompt.ts or weights in model.ts…
npm run bench -- --live --save        # run B
npm run bench -- --compare bench/results/<A>.json bench/results/<B>.json
```

The compare output shows, per repo, A vs B level/score and which run is **closer to the
expected level**, plus the net improved/regressed count, so quality changes are measured,
not assumed.

> Subscription note: headless `claude -p` draws from your plan (reported `total_cost_usd`
> is the equivalent, not a charge). Keep eval batches reasonable; for very large sweeps
> consider the metered Gemini/Bedrock providers.

## The tuning loop

1. `npm run bench` → read agreement + dimension distribution.
2. Adjust the rubric in [`src/lib/maturity/model.ts`](../src/lib/maturity/model.ts):
   - **`DIMENSIONS[].weight`**: rebalance which axes drive the overall score.
   - **`SCORE_BLEND`**: how much the LLM nudges vs. the deterministic signal (mock mode
     ignores this; it matters for live scoring).
   - **`LLM_GUARDBAND`**: how far the LLM may move a dimension from its signal score.
   - **`LEVELS[].band`**: the score→level cutoffs.
3. Or adjust detector thresholds/points in [`src/lib/analyze/index.ts`](../src/lib/analyze/index.ts)
   (e.g. test-count tiers, signal point values).
4. Re-run. Repeat until within-1-level agreement is comfortably high and the distribution
   looks sane.

> Keep changes evidence-driven: change one thing, re-run, compare. The harness makes the
> rubric a measurable artifact rather than an opinion.
