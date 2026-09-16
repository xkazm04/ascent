# Architecture Decision Records

One file per decision, named `YYYY-MM-DD-<slug>.md`. An ADR records a choice that
constrains future code — the alternatives considered, the evidence, and what the
decision costs — so the next change can build on it instead of re-deriving it.

An ADR is **append-only once accepted**. Superseding it means a new ADR that says
so; editing an accepted ADR to match what the code drifted into destroys the only
record of why the drift was a change.

## What belongs here

A decision that a reader could reasonably reverse by accident: an import
convention, a boundary, a layering rule, a persistence choice. Not a bugfix, not a
refactor with no rule attached, and not a feature — features are documented in
`docs/features/<area>/` under the doc-sync rule in `AGENTS.md`.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [2026-09-07-db-import-convention](2026-09-07-db-import-convention.md) | Accepted | Per-domain barrels under `src/lib/db/`; the root `index.ts` is frozen. |

## A note on citations

Code that depends on a decision should cite the ADR **by filename**, and the ADR
must exist. `src/lib/db/index.ts:3` cited "Architect ADR 2026-08-28-server-only-boundary"
for over a year with no such file anywhere in the repo — the reasoning it pointed
at was only ever in a skill's session state. A citation to a missing document reads
exactly like a citation to a real one, which is worse than no citation: it stops
the reader from asking. This directory exists so that the next such reference has
somewhere true to point.
