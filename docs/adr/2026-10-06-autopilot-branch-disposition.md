# ADR 2026-10-06 — Disposition of the 15 stale autopilot branches

**Status:** Accepted 2026-10-06 (operator choice "Drop superseded, salvage code")
**Deciders:** operator, App Master ascent
**Supersedes:** nothing. **Superseded by:** nothing.
**Constrains:** the `autopilot/*` branches listed below and the delivery runs that follow this note.

---

## Context

15 `autopilot/*` branches cut between 2026-09-08 and 2026-09-15 sit unmerged on the
repo, each about 920 commits behind `master`. Two costs follow from leaving them:

- every App Master wake flagged them as open work, and
- the rule "reconcile before cutting a branch beside it" blocked new delivery
  branches, because each of the 15 looked like a parallel line of work.

The operator was asked what to do with them and chose **Drop superseded, salvage
code**. This note records that choice and keeps every tip SHA findable. It changes no
code and deletes no branch; the Director releases the branches after this merges.

## Decision

### (a) Superseded, dropped

Superseded by #18 (`08eb63a1`) and [0001-hosted-loop-dispatch.md](./0001-hosted-loop-dispatch.md).

| Branch | Tip |
| --- | --- |
| `autopilot/accepted-idea-delivery-to-the-main-branch-5` | `73256c1652` |
| `autopilot/design-hosted-dispatch-substrate-and-gate-plan` | `29fda5954c` |
| `autopilot/implement-hosted-loop-dispatch-with-tests` | `65a47243ec` |

### (b) Docs-only dated plans and audits, dropped

Abandoned and not carried to `master`.

| Branch | Tip |
| --- | --- |
| `autopilot/project-kpi-and-coverage-stewardship` | `2e652c9025` |
| `autopilot/project-kpi-and-coverage-stewardship-2` | `4b918ab3a8` |
| `autopilot/project-kpi-and-coverage-stewardship-3` | `2c78c980a2` |
| `autopilot/scope-round-2-pick-least-covered-contexts-and-pl` | `4a4a38413d` |
| `autopilot/scope-round-2-pick-least-covered-contexts-and-pl-2` | `ba6f1d43ff` |
| `autopilot/scope-the-parity-plan-and-map-targets-to-primiti` | `5123f0a385` |
| `autopilot/implement-shared-primitives-tooltip-grid-migrati` | `8469c755c8` |
| `autopilot/scope-uc1-light-green-increment-and-backlog-the` | `700d187069` |

### (c) Code, dropped

| Branch | Tip |
| --- | --- |
| `autopilot/accepted-idea-delivery-to-the-main-branch-2` | `a51ed06dbd` |

It moved org invariants into `src/lib` (32 files). It is too far behind to land, and
its layering change is not adopted by this decision.

### (d) Code, to be salvaged by fresh rebuilds on `master`

One delivery run each, in this order. A run is closed instead of built if `master`
already fixed the thing.

| Order | Branch | Tip | What it carries |
| --- | --- | --- | --- |
| 1 | `autopilot/implement-ai-foundation-pr-and-gate-api-mentions` | `48b57cdeae` | The landing page names the `.ai/` foundation PR and the gate API. |
| 2 | `autopilot/accepted-idea-delivery-to-the-main-branch-3` | `d9d9c8ea05` | Three e2e fixes. It contains `autopilot/accepted-idea-delivery-to-the-main-branch-1` (`9651847c19`), so `-1` has no separate run. |

## Alternatives that lost

- **Drop all 15.** Simplest, and it would clear every wake. It lost because it throws
  away two small code changes (the landing copy and the three e2e fixes) that are
  still useful and cheap to rebuild.
- **Salvage code and also carry the latest docs as archived docs.** It lost because
  dated plans written before 920 commits of drift mislead a reader more than they
  inform; an archived plan reads as current intent.
- **Leave them all.** It lost because every wake keeps flagging the branches and the
  reconcile-before-branching rule keeps blocking new delivery branches.

## Consequences

- The tip SHAs in this note are the only pointer to the dropped work after release.
  They stay reachable through the reflog, or on the remote only if the branches were
  pushed; once garbage-collected they are gone.
- The salvage runs in (d) rebuild from intent on current `master`, not by
  cherry-pick, so they inherit none of the old branches' drift.
- The layering change in (c) is not adopted. Anyone wanting org invariants in
  `src/lib` has to propose it again against the current tree.
