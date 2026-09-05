---
note_type: engine-expected
call_site: tailored-adopt
use_case: UC2
implied_by: docs/GOLDEN-USE-CASES.md - UC2 design, Phase E "tailored adopt (an LLM lane; a new /tiger call site)"
status: expected
tags: [engine, expected, uc2]
---

# Expected call site - `tailored-adopt` (UC2 Phase E)

The second LLM call site in the product, not built yet. Tiger pre-registers the bar so the
first run after it lands diffs against this note instead of starting cold.

## The job it will serve
Rewrite a generic skill's assumptions into *this* repo's real commands, paths and domain
(`adopt`), or generalize a repo skill for the registry (`share`) - the Personas
`adoptTaskPrompt` / `shareTaskPrompt` idea, fleet-scaled. Result is delivered as a **PR to the
target repo** (`POST /api/org/skills/:name/tailor?repo=`), never as a silent file write.
Loop position: observe -> propose -> **adopt (tailored)** -> track -> improve -> redistribute.

## Grounding bar (what must reach the prompt on day one)
Canonical source list - score `grounding N/6` against exactly this list:
1. the repo's **detected command set** (test / lint / build / typecheck, from the report that
   the scan already produced) - the computed-but-not-wired question #1
2. the repo's **stack / stack-fit** (language, build tool, frameworks) - so a JVM repo never
   gets node-shaped commands (Anika's test)
3. the repo's **CLAUDE.md / `.ai/` context map** (existing conventions the tailored skill must
   respect)
4. the **source skill** verbatim, with `category / memory / version` marked as immutable
5. the **fleet / registry state** for this skill (`catalog.json`: adopters, versions, lessons) -
   so the tailoring knows what the org's canonical version says (Priya's test)
6. **Org Memory** relevant to the repo (prior decisions, declined practices) - memory grounding

OUT direction: the PR body must state which of the six sources were used and which could not be
grounded ("honest about what it could not ground" - the UC2 row of the jobs table).

## Machinery bar (Lens A dials it must clear on day one)
- goes through the same provider chokepoint as `scan-assess` (`src/lib/llm/**`), never a
  direct SDK call - retry / failover / timeout / budget / abort inherited
- structured output: `{ frontmatter (verbatim), body, groundingReport[] }` with a **never-throw**
  validator; a parseable-but-empty body is a failure, not a PR
- **frontmatter preserved by construction** - the validator re-asserts `category / memory /
  version` equal the source's; a diff there fails the call (UC2 hard check)
- input / output bounds (skill bodies are long; cap the body and the grounding context)
- usage metered only on a usable attempt; prompt + response into the opt-in eval log
  (`ASCENT_EVAL_LOG_DIR`) with secret redaction
- prompt-caching on the stable prefix (the source skill + instructions are identical across
  repos; only the repo context varies)
- degrade path: no model -> no PR, loudly ("tailoring needs a model"); never a generic copy
  served as tailored

## Lens C starting hypothesis
Output-token heavy (a whole SKILL.md body), long-form prose -> benchmark at most low vs medium
thinking; expect a mid model as the floor (the 2026-06-20 benchmark's "cheap models degrade the
prose" result applies); test whether a cheap model holds for `share` (generalizing is more
extraction-like) vs `adopt` (rewriting against repo specifics).

## Judges
Priya (must-pass), Marcus, Anika. Fixture: one generic skill x two repos of different stacks
(node + JVM) with known command sets; plant a command the detector found that the prompt must
use.
