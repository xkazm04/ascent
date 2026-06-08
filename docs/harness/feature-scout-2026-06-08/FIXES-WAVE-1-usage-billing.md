# Feature Scout Fix Wave 1 — Usage → billing

> 4 of 6 findings closed in 4 atomic commits — the full capture → persist → surface chain that turns
> metering into a billing view. 2 deferred. Baseline preserved: tsc 0 → 0 · eslint clean · `next build`
> green · `prisma generate` clean.

## Why this wave matters

This was the scan's single loudest cross-cutting signal — multiple scouts independently flagged that
the product sells "usage metering" but the `/usage` view shows **no money** ("Per-scan rate is TBD"),
because the providers discarded the token counts they already return. This wave wires the whole chain:
capture tokens → persist them → surface estimated cost + per-repo spend.

## Commits

| # | Commit | Finding | Sev | What |
|---|--------|---------|-----|------|
| 1 | `67555e4` | LLM-1 | High | capture per-scan token usage + latency from every real provider |
| 2 | `5fa4812` | PERS-1 | High | persist tokens + latency on the Scan row |
| 3 | `1f693c3` | USE-2 + USE-1 | High | show estimated cost + tokens + top repos on /usage |

## What was fixed

1. **LLM-1** — Gemini/Bedrock/OpenAI all return token usage; the scan threw it away, so metering could
   only count scan rows. Added an optional `onUsage` hook on `AssessOptions`; each real provider reports
   its usage (Gemini `usageMetadata`, Bedrock `res.usage`, OpenAI `data.usage`); `scan.ts` captures the
   winning provider's usage + the LLM-stage latency onto `report.usage`. (mock/keyless report nothing.)
2. **PERS-1** — Added `inputTokens` / `outputTokens` / `llmLatencyMs` to `Scan` (schema.prisma +
   init.sql, additive + nullable) and write `report.usage` in `persistScanReport`. The cost dimension
   the product needs to bill on consumption / see margin / cap runaway spend.
3. **USE-2 + USE-1** — Extended `getUsageSummary` with period token sums, an **estimated cost** from
   configured per-MTok rates (`LLM_INPUT_COST_PER_MTOK` / `LLM_OUTPUT_COST_PER_MTOK`; `null` → "set a
   rate" instead of a fake number), and a **byRepo** top-10 breakdown. The `/usage` page now shows an
   Est. cost / input / output tokens row and a "Top repositories" panel, replacing "rate is TBD".

## Deferred (with cause)

- **USE-6 (period-over-period + date-range picker)** — Low priority, and a `usage/page.tsx` UI control
  (the page the concurrent UI run also touched this session). Deferred.
- **PERS-2 (Subscription + plan-quota enforcement)** — the bigger stretch: a `db/subscriptions.ts`, a
  Stripe webhook route, and quota gating in the scan route. Real revenue plumbing deserving its own
  focused session (and the now-persisted token cost is the input it needs).

## Verification (before → after)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 → 0 errors |
| `eslint` (9 changed files) | 0 errors, 0 warnings |
| `prisma generate` | clean (3 new Scan columns) |
| `next build` | ✅ all routes compiled |
| live token capture / DB migration | NOT runtime-exercised here (no API keys, no live DB). Verified by tsc + build + the SDK usage-field types compiling; the migration is additive/nullable (deploy applies via `prisma migrate deploy` / `db push`); `report.usage` is null-safe end-to-end. |

## Patterns established (catalogue addition, item 13)

13. **Optional out-param callback to surface call metadata** — when a function returns a domain value
    (the assessment) but a consumer also needs call metadata (token usage), expose it via an OPTIONAL
    callback on the options (`onUsage`) rather than changing the return shape: non-breaking, providers
    that lack it simply don't call it, and the metadata threads to exactly the caller that wants it.

## What remains

Wave-1 leftovers: USE-6, PERS-2 (above). Other scan waves: 7 (export/alerts/compliance) + the
deferrals from waves 4/5/6 + mediums/lows, per the INDEX.
