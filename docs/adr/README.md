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
| [2026-09-14-org-path-of-use](2026-09-14-org-path-of-use.md) | Accepted (2026-10-05, journey B) | One path of use for the Org modules. |
| [2026-10-06-autopilot-branch-disposition](2026-10-06-autopilot-branch-disposition.md) | Accepted (2026-10-06) | Drop 12 of 15 stale `autopilot/*` branches; salvage the 2 code runs by rebuild on master. |
| [2026-10-07-failed-read-is-not-absence](2026-10-07-failed-read-is-not-absence.md) | Accepted (2026-10-07, recorded after the fact) | A failed read is never shown as absence: class A fails visibly (`dbReadStrict`), class B degrades but reaches a door. |
| [2026-10-07-briefing-pdf-free-on-every-tier](2026-10-07-briefing-pdf-free-on-every-tier.md) | Accepted (2026-10-07) | The executive briefing PDF stays free on every tier: a declared exception to the report PDF's `pdfExport` gate. |
| [2026-10-07-shared-public-org-has-no-owner](2026-10-07-shared-public-org-has-no-owner.md) | Accepted (2026-10-07) | The shared public org has no owner: every admin write refuses it, billing and autoscan cadence too; non-members scan into it.|
| [2026-10-08-pr-gate-fails-closed](2026-10-08-pr-gate-fails-closed.md) | Accepted (2026-10-08) | The PR gate fails closed: no `neutral` check, a floor on a missing dimension fails, the Action scores the PR head. |
| [2026-10-08-private-scan-stores-no-file-text](2026-10-08-private-scan-stores-no-file-text.md) | Accepted (2026-10-08) | A private repo's scan stores no text copied from its files (quotes, guidance rules and commands, manifest prose); local copies are exempt; model prose and a re-read's lost quotes are open. |
| [2026-10-08-ambient-token-only-for-proven-public](2026-10-08-ambient-token-only-for-proven-public.md) | Accepted (2026-10-08) | The server's own GitHub token touches a repo only once it is proven public; a private repo answers like a missing one and never enters the shared anonymous cache. |
| [2026-10-08-push-rescan-is-a-queued-job](2026-10-08-push-rescan-is-a-queued-job.md) | Accepted (2026-10-08) | A push rescan is a `webhook:push` job on the ScanJob queue, gated on watched AND a cadence other than off, one job per repo per aligned window, a 6 h backoff after a failure; whether a BYOM org is charged for it is open. |

## A note on citations

Code that depends on a decision should cite the ADR **by filename**, and the ADR
must exist. `src/lib/db/index.ts:3` cited "Architect ADR 2026-08-28-server-only-boundary"
for over a year with no such file anywhere in the repo — the reasoning it pointed
at was only ever in a skill's session state. A citation to a missing document reads
exactly like a citation to a real one, which is worse than no citation: it stops
the reader from asking. This directory exists so that the next such reference has
somewhere true to point.
