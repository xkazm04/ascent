# Reference-Scan Audit: World-Class Orgs (2026-07-05)

Validation of ascent's scan outputs against a reference corpus of world-class public GitHub orgs, and the resulting framework-improvement backlog.

## What we did

Scanned the 10 newest public repos of 10 organizations chosen for engineering excellence and language/domain diversity, using the **real product pipeline** (`POST /api/org/import`, `mock:false`) with **Claude Sonnet via `claude-cli`** as the scorer. Every scan is genuine LLM output (zero mock degrades).

**Corpus:** `rust-lang, golang, astral-sh, vercel, stripe, grafana, clickhouse, tokio-rs, cloudflare, huggingface`, spanning Rust, Go, TypeScript, Python, C++; toolchains, web/AI SDKs, fintech, observability, databases, async systems, edge, ML. **119 scans total** (109 unique; vercel & clickhouse carry pre-existing scans from earlier sessions).

**Method:** After scanning, each org was dumped in full (rollup + all 10 org modules + every per-repo `ScanReport`) and analyzed by (1) a deterministic stats pass and (2) four parallel audit agents (calibration/bias, LLM-discrepancy mining, completeness root-cause, narrative quality). Raw data in `reference-data/`.

> **Infra caveat (honest disclosure):** midway through, the dev server crashed: PGlite disk-persistence began failing with `Access is denied (os error 5)` (a Windows file-lock on the rapid WAL writes; systemic even on a fresh copied cluster, likely Defender; needs a reboot or a Defender exclusion). Work was completed with persistence **disabled** (in-memory) and the per-org JSON dumps treated as the durable artifact. On-disk DB (`.pglite/ascent`) holds the first ~55 scans; the full 10-org dataset lives in `reference-data/*.json`. See the "DB durability" note at the end.

---

## Part 1. Validation verdict: can we trust our scans on public repos?

**Split verdict.**

- **The LLM-authored narrative is production-grade.** Headlines, strengths/risks, per-dimension summaries, and roadmaps are specific, accurate against ground truth, non-hallucinatory, and frequently insightful (e.g. correctly inferring golang's off-GitHub Gerrit lifecycle; distinguishing "ships an AI product" from "governs its own repo" for `stripe/ai` and `vercel/ai`). The `discrepancies[]` self-critique field is a genuine differentiator: the model actively catches its own detectors' false positives.

- **The numeric scores are NOT yet trustworthy for orgs whose CI, review, and security live off GitHub.** The deterministic signal layer is GitHub-Actions/GitHub-native-centric, so world-class orgs on Gerrit/bors/LUCI are systematically under-scored: **a visibility gap misread as an engineering-maturity gap.** The scanner is measuring *"has committed AI-config artifacts + gated GitHub Actions"* more than *"is AI-native in practice."*

**The clearest evidence.** Same org, differing only by CI *hosting*:

| Repo | D3 (CI/CD) | Why |
|---|---|---|
| `golang/go` | **1** | CI runs on Gerrit/LUCI TryBots, invisible to a `.github/workflows`-only detector |
| `golang/appengine` | **74** | Same org, but *has* GitHub Actions |

`golang` rolls up to **avgOverall 20 ("Manual")**, one of the most rigorously engineered codebases on Earth, labeled bottom-tier. Meanwhile `vercel` (GitHub-Actions-native, TS) tops the corpus at **57**. Crucially, the bias is **not language**: `huggingface` (Python/ML) scores **52** *because it is GitHub-Actions-native*.

**Per-org overall scores:**

| org | avg overall | note |
|---|---|---|
| vercel | 57 | GHA-native |
| huggingface | 52 | GHA-native (Python, not penalized) |
| cloudflare | 47 | |
| grafana | 43 | |
| astral-sh | 42 | |
| stripe | 40 | |
| tokio-rs | 39 | Rust, some off-GHA |
| rust-lang | 37 | bors merge-queue partly off-GHA |
| clickhouse | 36 | C++, own CI |
| **golang** | **20** | **Gerrit/LUCI: floored by blind spots** |

**Fleet per-dimension averages:** D1 28 · D2 57 · D3 62 · D4 **17** · D5 44 · D6 47 · D7 59 · D8 **22** · D9 39.
**Score distribution (119 scans):** L1 ×30 · L2 ×31 · L3 ×43 · L4 ×15 · **L5 ×0**.

---

## Part 2. Completeness audit

Every **org module** populated for all 10 orgs (rollup, delivery/PR signals, governance, security, teams, practices, benchmark, movers, backlog, discrepancies, contributors), 10/10 ✓. Per-repo core fields are solid: `governance` 100%, `contributors` 100%, `roadmap/strengths/risks` 100%, `prStats` 98%, `commitActivity` 97%, `discrepancies` 91%.

Gaps found (with root cause):

| Field | Rate | Classification | Root cause | Severity |
|---|---|---|---|---|
| `warnings` | 1% | **PERSIST bug** | No `warnings` column on the `Scan` model at all → degrade / low-coverage / no-token caveats are **lost on reload**; a reloaded degraded scan reads as a confident full scan. Only the stack-fit caveat is recomputed on read. | **P1** |
| `aiUsage.signals` | 0% | **DATA bug** | Never populated; `aiUsage.detected` is derived from bot-commit fraction, not real AI usage (see Part 3). | **P0** |
| `passport` | 0% (on read) | READ omission | `getScanReportByCommit` (`scans-read.ts:836-873`) omits the key. Persisted fine (`scans-persist.ts:261`); /org Passports read `Repository.passportJson` (populated); report page refetches via `/api/report/passport`. Cosmetic + one redundant fetch. | P2 |
| `techStack` | 0% (on read) | READ omission | Same return-literal omission; no report-page consumer; /org StackMatrix reads `Repository.techStackJson` (populated). Cosmetic. | P2 |
| `usage.inputTokens` | 0% | EXPECTED + READ omission | `claude-cli` never calls `onUsage` (`claude-cli.ts:41-62`) → `/usage` cost panel blank for claude-cli deploys (by design, subscription auth). Also not reconstructed on read for any provider. | P2 |

---

## Part 3. Calibration & quality findings

### The structural root cause
The engine blends `0.6·LLM + 0.4·signal` and **clamps the LLM to ±25 of the deterministic signal** (`LLM_GUARDBAND=25`); **D9 is fully deterministic** (the LLM can't move it at all). So when the LLM *correctly writes* "this 0 is a Gerrit visibility gap, not a real absence," the guardband mathematically pins the score near the broken signal. **The system already knows it's wrong in prose but is architecturally forbidden from acting on it.** This is the single highest-leverage structural issue.

### 213 self-reported detector misses
The LLM auditor flagged **213 discrepancies across 108/121 scans** (`reference-data/all-discrepancies.json`). Most-wrong detectors: D6 (35), D3 (33), D5 (26), D2 (25), D9 (23). The highest-confidence subset are **cross-dimension self-contradictions** the model caught: D6 "no linting" while D3 "CI runs linting" (same repo); D4 "auto-merge enabled" while D9 "no dependency tool."

### AI-dimension validity
- Low D1/D4/D8 on these orgs are **mostly genuinely correct.** These repos really do lack `CLAUDE.md`/agentic-CI/eval-harnesses; grading that low on an *AI-native* rubric is legitimate, not bias.
- But **D1 is near-binary on file presence**: mean D1 = **64** with a guidance file, **2** without (58/60 fileless repos ≤10). A team with excellent AI conventions in a wiki/`CONTRIBUTING.md`/PR-template scores ~2.
- **`aiUsage.detected` (71%) is spurious.** It tracks bot-commit fraction (Renovate/Dependabot), not AI. Only ~20% of "detected" repos have real `aiInvolvedRate ≥ 10%`. The *good* signal (`prStats.aiInvolvedRate` with per-tool Claude/Cursor/Codex counts) already exists and is unused.
- **Phantom detector false-positive:** "AI code-review agent in the pipeline" is credited to `golang/go`, `rust-lang/rust` (which run none), inflating D4.

---

## Part 4. Prioritized improvement backlog

### P0: fix before trusting numeric scores on diverse orgs

> **Status (2026-07-05): all 5 P0 items IMPLEMENTED + tested.** The GitHub-Actions path is kept byte-identical in every change, so existing calibration doesn't drift; only off-GitHub / previously-floored repos move. Regression tests in `src/lib/analyze/signals.test.ts` and `src/lib/security/checks.test.ts` lock in each fix against the real world-class-repo signatures (Gerrit/bors trailers, CI-inline clippy, job-level permissions, bot-vs-AI). Full suite green except 4 pre-existing failures in unrelated billing/credits WIP.

- ✅ **P0-1 · D3 detect off-GitHub CI.** Recognize Gerrit/TryBots, bors/homu, Buildkite, LUCI/Prow (commit trailers `Reviewed-on:`/`TryBot-Result`/`bors r+`, markers `bors.toml`/`.buildkite/`); decouple D3 sub-signals from `workflowText`-only (also scan Makefile/justfile/Taskfile/CI scripts). *Lifts golang/rust/clickhouse out of the false floor.* (`src/lib/analyze/index.ts`, d3, ~300-357; `workflowText` 36-41)
- ✅ **P0-2 · D3/D6 credit guardrails enforced inline in CI** (not just standalone config files): scan workflow YAML for `cargo clippy`/`cargo fmt`/`go vet`/`golangci-lint`/`ruff`/`mypy`/`eslint`/`biome`/`tsc --noEmit`/`make lint`. *Resolves the #1 discrepancy cluster and the D6↔D3 self-contradiction.* (`src/lib/analyze/index.ts`, d6, ~431-466)
- ✅ **P0-3 · D9 make GitHub-native checks `n/a`, not `0`, without GitHub CI** (SAST/SBOM/signed-releases/dependency-updates); add off-GitHub detectors (`govulncheck`, `cargo-audit`/`cargo-deny`); fix the token-permissions regex `^permissions:` → `^\s*permissions:` (currently misses job-level least-privilege blocks). See `src/lib/security/checks.ts`.
- ✅ **P0-4 · Teach D6/D7 + branch-protection to read merge-queue/Gerrit review** from commit trailers (`r=`, `Reviewed-on:`, `Change-Id`, `TryBot-Result`) so "0% reviewed / nothing stops a merge" stops firing on stricter-than-GitHub gates. See `src/lib/analyze/pulls.ts` (~91,132).
- ✅ **P0-5 · Fix `aiUsage`.** Re-derive `detected` from `prStats.aiInvolvedRate` + guidance-file presence (real AI usage), not `commitFraction` (≈ Renovate rate); populate `aiUsage.signals`. Corrects the headline "71% AI-detected" from spurious to real (~20%).

### P1

> **Status (2026-07-05): all 5 P1 items IMPLEMENTED + tested.** Tests in `signals.test.ts`, `checks.test.ts`, `engine.test.ts`. P1-5 adds a nullable `warningsJson` column (schema.prisma + init.sql with an idempotent `ALTER … ADD COLUMN IF NOT EXISTS` so existing local `.pglite` DBs pick it up on the next boot without a wipe); `prisma generate` run, `init-sql` mirror test green, `tsc --noEmit` clean.

- ✅ **P1-1 · Close the guardband/self-critique loop.** When the LLM emits a high-confidence "visibility blind spot" discrepancy, treat the deterministic signal as **UNKNOWN** (exclude/renormalize) rather than a measured 0, so the LLM's correct diagnosis can move the number (`src/lib/scoring/engine.ts`, ~100-109).
- ✅ **P1-2 · Org/App-level dependency-bot detection.** Behavioral fallback: when no committed `dependabot.yml`/`renovate.json`, scan commit authors for `dependabot[bot]`/`renovate[bot]`/`chore(deps)` fingerprints; credit D9 dep-updates + D4. Resolves the D4↔D9 contradiction (`src/lib/security/checks.ts:100`).
- ✅ **P1-3 · Tighten keyword false-positives (D3/D2).** Scope path matches to root/core (exclude `examples/`, `benches/`, `fixtures/`, `docs/`); require config-file evidence over bare words (`migrate`/`policy`/`feature-flag`); exclude `zizmor` from policy-as-code (`src/lib/analyze/index.ts`, ~335-354).
- ✅ **P1-4 · D1/D4/D8 detect practice, not just artifacts.** Credit AI conventions in `CONTRIBUTING`/wiki/PR-template prose + org-level; feed per-tool `aiInvolvedRate` into D4; broaden paths (`copilot-instructions.md`, `AI_POLICY.md`, `AI-TOOLS.md`, `.claude/skills/`, `benchmarks/**/grade*`); fix the phantom "AI code-review agent" match on golang/rustc.
- ✅ **P1-5 · Persist `warnings`.** Add `warningsJson` column + write on persist + merge with the recomputed stack-fit caveat on read. Stops degraded/low-coverage/no-token scans reading as confident full scans on reload. Files: `prisma/schema.prisma` (Scan), `scans-persist.ts`, `scans-read.ts`

### P2

> **Status (2026-07-05): P2 complete + read-path residual closed.** P2-1–P2-5 implemented + tested (`tsc --noEmit` clean, full suite green except the 4 pre-existing billing-WIP failures). P2-6 is data/doc-only: the import route already lowercases org slugs (no new `ClickHouse`/`clickhouse` dupes), the "null reports" are watched-but-unscanned repos (expected, not a bug), and the mega-org "latest-updated 10" caveat is documented in Part 1.
>
> **`aiUsage` fully persisted (follow-up done):** a nullable `aiUsageJson` column (schema.prisma + init.sql idempotent `ALTER`) now stores the fresh scan's `aiUsage` verbatim; `getScanReportByCommit` prefers the persisted value and falls back to the reconstruction only for legacy rows, so a reloaded/permalinked report reproduces the fresh scan's detection (incl. guidance-file-only), closing the last residual.

- ✅ **P2-1 · Reader completeness.** `getScanReportByCommit` now returns `passport` (with owner overrides, for parity with `getRepoPassport`), `techStack`, and `usage`; `aiUsage` is reconstructed from the PR-level signal (not the bot fraction) with populated `signals` (`src/lib/db/scans-read.ts`).
- ✅ **P2-2 · D2 test detection.** Testify (`(require|assert).\w+(`) now parses as substantive; tests are credited when CI runs `cargo test`/`go test` with no matching test files (Rust doctests) (`src/lib/analyze/index.ts`).
- ✅ **P2-3 · D5 docs detection.** README section counter now includes HTML `<h2>` + Setext headers; `apps/docs` sites and `llms.txt` credited (`src/lib/analyze/index.ts`).
- ✅ **P2-4 · D7 AI-authorship.** The adoption credit keys on genuine AI co-author trailers, not automation bots (Renovate/Dependabot/Speakeasy); bot-only histories get a neutral note (`src/lib/analyze/index.ts`).
- ✅ **P2-5 · claude-cli token metering.** The CLI's `usage` envelope (input/output + cache tokens) is now reported via `onUsage`, populating the `/usage` volume/latency panel (cost stays ~$0 under subscription) (`src/lib/llm/claude-cli.ts`).
- **P2-6 · Data hygiene (no code change).** The import route already lowercases org slugs (prevents new `ClickHouse`/`clickhouse` dupes); the "null reports" are watched-but-unscanned repos, not a bug; the mega-org "latest-updated 10" caveat is noted in Part 1.

---

## Appendix

- **Raw data:** `reference-data/dump-<org>.json` (full rollup + modules + per-repo reports), `reference-data/all-discrepancies.json` (213 structured discrepancies), `reference-data/stats.txt` (quantitative pass).
- **DB durability:** persistence is currently blocked at the OS level (see infra caveat). To restore: reboot (or add a Defender exclusion for the PGlite data dir), then re-run the import or re-load from the dumps. `.env.local`'s `PGLITE_DATA_DIR` was temporarily pointed at `.pglite/ascent2` during recovery and has been reverted to `.pglite/ascent`; the `.pglite/ascent2` copy can be deleted.
- **Headline takeaway:** the framework's *thesis* (grading AI-native maturity) and its *LLM layer* are sound; the *deterministic signal layer* is too GitHub-native-centric to trust on elite off-GitHub codebases. The P0 fixes above are what make the scores defensible on the full diversity of world-class engineering.
