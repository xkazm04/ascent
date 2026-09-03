# CONTEXT: <module path>

> Co-located, agent-readable context for this module. Keep it short and TRUE. When the code here
> changes materially, update this file in the same change (the doctor flags it as stale otherwise).

## Owns
What this module is responsible for, in one or two sentences.

## Public contract
The surface other code/agents depend on (exports, routes, events, schema). Changing these is a
breaking change: call it out.

## Invariants: never break
- <e.g. "all DB access goes through repo.ts; never raw SQL here">
- <e.g. "no secrets read directly; use the vault capability">

## Key files
- `<file>`: <what it does>

## Data flow
How data enters, moves through, and leaves this module.

## Decisions & memory
Links to ADRs / `.ai/memory` entries that explain *why* this module is the way it is.
