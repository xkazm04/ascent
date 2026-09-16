# Architecture Decision Records

One file per consequential, hard-to-reverse decision: `NNNN-kebab-title.md`, numbered in the order
they were **proposed**, never renumbered. A record is written when the choice is made, not
afterwards, and it is never edited to look current — a decision that turns out wrong gets a NEW
record that supersedes it, and the old one keeps its text and gains a `Superseded by` line.

Status is one of `Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Rejected`. A record stays
**Proposed** until every stakeholder it names has signed off; the sign-off date goes in the record.

Each record carries, at minimum: the **constraint that forced the choice**, the decision, at least
**three alternatives that lost and why they lost**, and the consequences the team accepts by
choosing. An alternatives section that lists only straw men is the failure mode this format exists
to prevent — a losing option should be one a reasonable engineer would have argued for.

This is not the only decision surface in the repo. `.claude/ship-loop/decisions.md` is the ship
loop's running `D##`/`CP##` log (fast, in-flight, one line each); `docs/specs/` holds implementation
specs with authoritative write sets. An ADR is for the choice **between shapes**, before a spec has
a write set to be authoritative about.

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-hosted-loop-dispatch.md) | Hosted loop dispatch: substrate, gate mapping and API contract | Proposed (2026-09-14) |
