# ADR 2026-09-14 — One path of use for the Org modules

**Status:** Proposed — awaiting operator sign-off (goal `4ab0f17f`)
**Deciders:** operator (CEO-level counsel), App Master ascent
**Supersedes:** nothing. **Superseded by:** nothing.
**Constrains:** `ORG_NAV_GROUPS` and every org tab's outbound links.

---

## Context

The org dashboard has **27 tab ids** (`ORG_TAB_IDS`), of which **25 are rail
items** (`segments` and `developer` are deliberately off-rail). W1a regrouped them
from six data-type modules into five question-shaped lanes — Standing / Shared /
In flight / Bought / Admin — with the stated intent that the nav should "read as a
story with a next move" (`src/lib/org/orgTabs.ts:120-134`).

It does not yet. The lanes name five *questions*; they do not order them, and
nothing in a tab says what the next move is. The consequence is measurable.

### The product declares its path of use three times, and the rail is none of them

| Where | Shape | Tabs it reaches |
| --- | --- | ---: |
| `src/components/about-org/loopSteps.ts` | 5 ordered verbs: Connect → Scan → Read → Decide → Apply | 4 (`settings`, `repositories`, `overview`, `followups`) |
| `src/components/onboarding/tour/steps.ts` | 6 ordered onboarding steps | 3 (`overview`, `repositories`, `executive`) |
| `src/lib/org/orgTabs.ts` `ORG_NAV_GROUPS` | 5 unordered lanes | 25 |

The two artifacts that *do* express a journey are the marketing page and the
first-run tour. Between them they name **5 of 27 tabs**. Once the tour is
dismissed, the returning user is handed a 25-item rail and no order.

`loopSteps.ts` also still labels its steps with the **pre-W1a group names** —
`Govern`, `Fleet`, `Overview` — for 3 of its 5 steps. The page that teaches the
loop points at lanes the rail no longer has.

### Traversal between tabs is sparse and one-directional

Static link graph over `src/features/**` and `src/components/org/followups`
(literal `orgTabHref(slug, "<id>")` sites, tests excluded; 93 call sites total):

- **10 tabs have no inbound link from any sibling tab** — `digest`,
  `tech-stacks`, `adoption`, `registry`, `memory`, `members`, `governance`,
  `pairing`, `audit`, `settings`. The rail is their only entrance.
- **3 tabs are fully isolated** (no inbound, no outbound): `memory`, `members`,
  `audit`.
- **9 tabs are dead ends** (no outbound link to any sibling): `followups`,
  `segments`, `security`, `practices`, `skills`, `memory`, `developer`,
  `members`, `audit`. For `followups` this is arguably correct — it is the
  designed hand-off point to a local agent. For the rest it is not a decision,
  it is an omission.

One honest caveat on those counts: Overview's Fix-first punch-list
(`src/features/standing/overview/fixFirst.ts:105`) links out **dynamically** to
whichever findings module is busiest — `security`, `teams`, `passports`,
`contributors` or `practices` — and is capped at 3 items. So `security` and
`passports` do have a conditional inbound edge, present only when they happen to
top the queue. A link that exists only on some days is not a path of use.

### Why this costs

Every tab is individually defensible and the set is not navigable. A user who
finishes a scan has no told next move; a user on `adoption` has no way back into
the loop; `memory`, `members` and `audit` can only ever be found by someone
already looking for them. Adding a 28th tab is cheap and makes it worse, which is
the shape of a structural problem rather than a backlog of missing links.

## Decision

**Adopt the operating loop's five verbs as the org's declared path of use, and
make every tab state its stage and its next move.**

1. The five verbs — **Connect → Scan → Read → Decide → Apply** — become the
   single named journey, declared once in `src/lib/org/` and consumed by the
   rail, the tour, `/about-org` and the tabs. Today those three surfaces each
   hold their own copy.
2. Every tab id is assigned to exactly one stage. A tab that fits no stage is
   the finding, not an exception: either it belongs behind another tab (as
   `segments` went behind `repositories`) or the stage set is wrong.
3. Every tab renders one **next move** — a named onward link to the tab that
   follows it in the loop, with its own state in the label. The 10 no-inbound
   tabs get their inbound edge as a by-product.
4. The five existing lanes stay as the rail's grouping. They are the *questions*;
   the loop is the *order*. This ADR does not re-open W1a.

Not decided here: whether the rail visually re-orders into stages, and whether
any tabs merge. Both are consequences to be measured after 1–3, not premises.

## Alternatives considered

### A — Links only: fill the 10 missing inbound edges, keep everything else

Cheapest by a wide margin and fully reversible. **Rejected as the whole answer**:
it makes the graph connected without making it ordered. A user could then reach
`memory` from somewhere, but still could not answer "what do I do after a scan?".
It solves the symptom this ADR measured and not the goal's stated problem — *no
shared vision of how an end user moves between them*. Retained as **wave 1 of the
decision above**, where the links are derived from the stage assignment instead
of hand-picked.

### B — Consolidate: merge 27 tabs down to ~10

Precedent exists and worked twice (`segments` folded into `repositories`; Plan
and Backlog retired into `followups` on 2026-08-17). Fewer tabs is a real path to
a legible surface. **Rejected as the starting move**: consolidation without a
declared journey is a guess about which tabs are secondary, it re-opens two
settled merges, and it is the least reversible option on the table — a merged tab
is expensive to un-merge. If stages 1–3 above show a tab that no stage claims,
merging it is then an evidenced decision rather than a taste call.

### C — A persistent "what now?" panel in the shell, tabs untouched

A single shell-level component (next to `ProgramStrip`, which already survives
tab navigation) computing the next action for the whole org. Attractive because
it is one component and zero per-tab work. **Rejected**: it centralizes the
journey *outside* the tabs, so each tab stays a standalone feature that happens
to sit under an advice bar, and the 27 surfaces keep drifting away from the
advice. It also duplicates Overview's Fix-first punch-list, which already
computes a top-3 next action and is the correct home for that logic.

## Consequences

- `ORG_NAV_GROUPS` gains a stage dimension; its completeness test extends from
  "every id is in a group" to "every id is in a stage".
- `loopSteps.ts` and `tour/steps.ts` stop being independent journey declarations
  and become views onto the shared one. The stale `Govern` / `Fleet` / `Overview`
  module labels die with the migration.
- One new per-tab UI obligation. A tab that ships without a next move fails the
  completeness test rather than shipping quietly.

## How this gets back-measured

Both numbers are produced by the same static link-graph scan used above, so the
claim that this improved is a number and not a description of work done:

| Metric | Today | Target |
| --- | ---: | ---: |
| Tabs with no inbound link from a sibling | 10 | 0 |
| Tabs inside a declared journey | 5 of 27 | 27 of 27 |
| Tabs with no outbound link to a sibling | 9 | ≤ 1 (`followups`, by design) |

## Open question for the operator

Is **Connect → Scan → Read → Decide → Apply** the journey, or is it the
*acquisition* journey with a different loop for the returning user? The five
verbs start at "install the GitHub App", which a returning org did months ago.
If the returning user's loop is really Read → Decide → Apply → Measure, that is a
scope answer only the operator can give, and it changes stage assignment for
roughly a third of the tabs.
