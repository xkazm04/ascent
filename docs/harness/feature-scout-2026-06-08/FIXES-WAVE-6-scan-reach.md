# Feature Scout Fix Wave 6 — Scan reach

> 2 of 6 findings closed in 2 atomic commits — the two cleanest, highest-value, zero-UI-collision
> provider-layer fixes. 4 deferred with cause. Baseline preserved: tsc 0 → 0 · eslint clean · `next build` green.

## Why these two

The LLM provider layer had the clean, verifiable, low-collision value this wave: env tuning (LLM-5)
and a whole new enterprise-requested provider (LLM-3). The other four (SCAN-1, SCAN-3 branch/token
form fields; SCAN-6 ingestion budget; LLM-4 health check) each have a `ScanForm`/UI half the
concurrent UI run is editing, are larger/moderate-risk, or are consumer-less — so they're deferred.

## Commits (shipped)

| # | Commit | Finding | Sev | What |
|---|--------|---------|-----|------|
| 1 | `5117e41` | LLM-5 | Med | env-configurable temperature + Bedrock maxTokens |
| 2 | `e1d3229` | LLM-3 | High | OpenAI / Azure-OpenAI / OpenAI-compatible provider |

## What was fixed

1. **LLM-5** — Temperature was hard-coded `0.2` in both real providers and Bedrock's `maxTokens`
   hard-coded `4096`, so a large-repo assessment could be truncated with no escape hatch and
   determinism couldn't be tuned without editing source. Added a shared `envNumber()` (llm/config.ts)
   and read `LLM_TEMPERATURE` (both) + `BEDROCK_MAX_TOKENS` (Bedrock). Defaults equal the prior
   literals — unset envs preserve exact behavior.
2. **LLM-3** — `ProviderName` was a closed 4-way union, so teams on OpenAI / Azure-OpenAI / a
   self-hosted OpenAI-compatible endpoint (vLLM, Ollama, LM Studio) couldn't run real scans at all.
   Added a **fetch-based** `OpenAiProvider` (no SDK dependency) using JSON mode + the shared assessment
   prompt + the `validateAssessment` safety net — the most portable path across compatible endpoints —
   configured via `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL`. Wired into `ProviderName`, the
   `resolveProviderChoice` allow-list, the `getProvider` switch, and `providerByName` (so the wave-3
   LLM-2 failover can target it). Select with `LLM_PROVIDER=openai`.

## Deferred (with cause)

- **SCAN-1 (branch/ref selector for web scans)** — the ingestion core already supports arbitrary `ref`;
  the missing piece is a body field on the scan route + a branch input on `ScanForm` (the form the
  concurrent UI run is editing). High value, clean backend — defer the UI half to avoid collision.
- **SCAN-3 (rate-limit headroom + token field)** — same `ScanForm` UI surface (a session-only token
  field) plus header passthrough. Deferred with SCAN-1.
- **SCAN-6 (configurable ingestion budget / monorepo sub-path)** — larger: threads new options through
  `FetchOptions → ScanOptions → cache key` and touches the byte-budget `source.ts` the learnings warn
  about. Moderate risk; deserves a focused session.
- **LLM-4 (provider health-check / "test connection")** — a meaningful check needs per-provider network
  calls (spend/latency/SDK), and the admin route would have no consumer UI yet. A config-presence check
  would be too shallow to be worth the interface change. Deferred.

## Verification (before → after)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 → 0 errors |
| `eslint` (6 changed files) | 0 errors, 0 warnings |
| `next build` | ✅ all routes compiled |
| live OpenAI scan | NOT run (no OPENAI_API_KEY here) — verified by tsc + build + contract reuse; the provider follows the exact assess()/validateAssessment shape as gemini/bedrock |

## Patterns established (catalogue addition, item 12)

12. **New provider via the existing contract, no new dep** — implement a new LLM provider as a
    fetch-based `LLMProvider` reusing `buildAssessmentPrompt` + `validateAssessment` (+ JSON mode for
    portability), then register it in the 4 seams (`ProviderName`, allow-list, `getProvider`,
    `providerByName`). Avoids an SDK dependency and inherits the whole resilience/abort contract.

## What remains

Wave-6 leftovers: SCAN-1, SCAN-3, SCAN-6, LLM-4 (above). Other scan waves: 1 (usage→billing),
7 (export/alerts/compliance) + mediums/lows, per the INDEX.
