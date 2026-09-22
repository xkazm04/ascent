# Architecture Decision Records

One file per decision, named `YYYY-MM-DD-<slug>.md`. An ADR records a choice that
constrains future code — the alternatives considered, the evidence, and what the
decision costs — so the next change can build on it instead of re-deriving it.

An ADR is **append-only once accepted**. Superseding it means a new ADR that says
so; editing an accepted ADR to match what the code drifted into destroys the only
record of why the drift was a change.

**Legacy exception:** [0001-hosted-loop-dispatch.md](./0001-hosted-loop-dispatch.md) predates this
convention — it was the lane's first record, filed under a numbered scheme (`NNNN-kebab-title.md`)
before `YYYY-MM-DD-<slug>.md` was settled on. It keeps its original filename rather than being
renamed to fit: `docs/features/org-planning/live.md` and other docs already cite it by that name,
and an ADR's own rule is that a past record is never edited to look current.

## What belongs here

A decision that a reader could reasonably reverse by accident: an import
convention, a boundary, a layering rule, a persistence choice. Not a bugfix, not a
refactor with no rule attached, and not a feature — features are documented in
`docs/features/<area>/` under the doc-sync rule in `AGENTS.md`.

Each record carries, at minimum: the **constraint that forced the choice**, the decision, at least
**three alternatives that lost and why they lost**, and the consequences the team accepts by
choosing. An alternatives section that lists only straw men is the failure mode this format exists
to prevent — a losing option should be one a reasonable engineer would have argued for.

This is not the only decision surface in the repo. `.claude/ship-loop/decisions.md` is the ship
loop's running `D##`/`CP##` log (fast, in-flight, one line each); `docs/specs/` holds implementation
specs with authoritative write sets. An ADR is for the choice **between shapes**, before a spec has
a write set to be authoritative about.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001-hosted-loop-dispatch](0001-hosted-loop-dispatch.md) | Proposed (2026-09-14) | Hosted loop dispatch: substrate, gate mapping and API contract. |
| [2026-09-07-db-import-convention](2026-09-07-db-import-convention.md) | Accepted | Per-domain barrels under `src/lib/db/`; the root `index.ts` is frozen. |
| [2026-09-14-org-path-of-use](2026-09-14-org-path-of-use.md) | Proposed | One path of use for the Org modules. |

## A note on citations

Code that depends on a decision should cite the ADR **by filename**, and the ADR
must exist. `src/lib/db/index.ts:3` cited "Architect ADR 2026-08-28-server-only-boundary"
for over a year with no such file anywhere in the repo — the reasoning it pointed
at was only ever in a skill's session state. A citation to a missing document reads
exactly like a citation to a real one, which is worse than no citation: it stops
the reader from asking. This directory exists so that the next such reference has
somewhere true to point.
