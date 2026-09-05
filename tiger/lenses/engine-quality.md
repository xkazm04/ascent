---
note_type: lens
lens: engine-quality
level: L1 (pure static — no model calls)
tags: [lens-a, code-audit]
---

# Lens A — Engine Quality (the integration code)

Audits the code *around* the model. No Characters, no model calls — `file:line` truth only. Score three dials per call site; track them across sessions (a dial that climbs is the headline of a good run).

## Dial 1 — Wrapping (`N/10`)
Is the call defended? Check, each worth evidence:
- provider abstraction / swappability
- retry + failover before a hard fail
- per-call timeout **and** a total budget across attempts
- abort/cancellation on client disconnect
- structured-output request (schema/tool-forced) + a **never-throw** decoder/validator
- a quality/coverage gate (empty-but-parseable reply ≠ success)
- input/output bounds (field length + array count — anti-injection, anti-bloat)
- graceful degradation to a flagged deterministic floor

## Dial 2 — Observability (`N/10`)
Can you debug a bad answer and bill it honestly?
- token-usage metering, **committed only on a usable attempt**
- latency capture
- per-attempt outcome logging (not just failures)
- **prompt + raw-response capture** for post-hoc eval (the single most common gap)
- request/trace id; cost attribution
- **secret/PII redaction** in any captured prompt/log
- an accumulating **eval corpus** (prompt → output → verdict) that Lens C can benchmark against

## Dial 3 — Caching (`N/10`)
Are you paying for the same tokens twice?
- result caching by a stable key
- **provider prompt-caching** (`cache_control` / `cachePoint`) on the stable prefix — usually the biggest single cost lever on input-heavy prompts
- in-flight dedup of identical concurrent calls
- context-size discipline (per-request vs re-sent-every-call)
Every gap carries a **cost implication**, not just a style note.

## Verdict
Emit Lens-A findings with `lens: engine-quality`, `character` omitted, `dimension ∈ {observability, cost, trust}`, `code_check` always set (`confirmed-absent | present-but-missed | …`). Strengths are first-class here — they say what NOT to touch.
