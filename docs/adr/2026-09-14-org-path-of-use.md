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

---

## Addendum 2026-10-05 — stage assignment, measured

Written so the open question above is answered against two concrete tables rather
than in the abstract. Nothing above this line is edited, **including the Status
line** — the status is the operator's call, not this addendum's.

The counts below come from `src/lib/org/tab-link-graph.ts`, pinned by
`src/lib/org/tab-link-graph.test.ts` and re-run on today's master. The original
ADR's figures came from an ad-hoc script, which is exactly why they could not be
re-checked; these can.

### 1. The link graph, re-measured

| Metric | ADR 2026-09-14 | Today 2026-10-05 | Pin |
| --- | ---: | ---: | --- |
| `ORG_TAB_IDS` | 27 | **29** | `src/lib/org/orgTabs.ts:14-77` |
| On-rail ids (not in `ORG_TABS_NOT_IN_NAV`) | 25 | **26** | `src/lib/org/orgTabs.ts:232-241` |
| Tabs with no inbound link from a sibling | 10 | **8** | `tab-link-graph.test.ts:90` |
| Tabs with no outbound link to a sibling | 9 | **6** | `tab-link-graph.test.ts:94` |
| Tabs inside a declared journey | 5 of 27 | **7 of 29** | `loopSteps.ts:23-55`, `tour/steps.ts:23-72` |

Three movements explain the deltas, and none of them is "navigation improved":

- **29, not 27.** `proposals` and `lessons` were split out of the Live cockpit on
  2026-09-15 (`orgTabs.ts:33-37`). The tab universe grew while the ADR sat
  Proposed, which is the ADR's own argument about a 28th tab, now observed.
- **26 on-rail, not 25.** `ORG_TABS_NOT_IN_NAV` is now three ids, not two:
  `followups` joined `segments` and `developer` as an **alias** that the org page
  redirects to `proposals` (`orgTabs.ts:17-18`, `orgTabs.ts:234`).
- **8 / 6, not 10 / 9.** `adoption`, `registry` and `governance` gained inbound
  edges; `surfaces` and `practices` gained outbound ones. The two no-inbound ids
  that are *new* to the list are `lessons` (born uncross-linked) and `digest`.

The exact lists on today's master:

- **No inbound (8):** `digest`, `tech-stacks`, `passports`, `lessons`,
  `security`, `memory`, `members`, `audit`.
- **No outbound (6):** `lessons`, `security`, `skills`, `memory`, `members`,
  `audit`. (`followups` is excluded as the designed dead end,
  `tab-link-graph.test.ts:84`.)
- **Fully isolated (5)** — ids appearing in *both* lists above: `lessons`,
  `security`, `memory`, `members`, `audit`. The ADR measured three (`memory`,
  `members`, `audit`); `lessons` and `security` have joined them, so the one
  number that got **worse** while the ADR sat Proposed is the one it called the
  structural problem.

One correction the re-measure forces on the ADR's own table: the row for
`loopSteps.ts` lists its fourth tab as `followups`. The file now points at
`proposals` (`loopSteps.ts:47`, `loopSteps.ts:53`), and it points there **twice** —
see §4.

### 2. Stage assignment under each journey

Both journeys assign **all 26 on-rail ids, each to exactly one stage**. Rows are
in `ORG_TAB_IDS` order. A `†` marks a tab placed **by elimination** — no stage's
verb describes what it renders; it went where it did because something had to
claim it. Those are §3.

The **next-move target** follows one rule, stated once rather than hand-picked per
tab (which is what Alternative A was rejected for): a tab's next move is the
**entry tab of the next stage**. Journey A's entries are `repositories` → `overview`
→ `proposals` → `live` → back to `repositories` (the return edge the product
already draws, `loopSteps.ts:68`: `LOOP_RETURN_INDEX = 1`, i.e. Scan). Journey B's
are the same through Apply, then `executive` for Measure and back to `overview`.
A `✓` means the edge **already exists** in today's graph; `(alias)` means it
exists only as a link to the `followups` alias, which redirects to `proposals`.

| Tab id | Journey A stage | A next move | Journey B stage | B next move |
| --- | --- | --- | --- | --- |
| `overview` | Read | `proposals` ✓ | Read | `proposals` ✓ |
| `executive` | Read | `proposals` | **Measure** | `overview` |
| `digest` | Read | `proposals` ✓ | **Measure** | `overview` |
| `repositories` | Scan | `overview` ✓ | Scan | `overview` ✓ |
| `tech-stacks` | Read | `proposals` (alias) | Read | `proposals` (alias) |
| `passports` | Scan | `overview` | Scan | `overview` |
| `live` | Apply | `repositories` ✓ | Apply | `executive` ✓ |
| `proposals` | Decide | `live` ✓ | Decide | `live` ✓ |
| `lessons` | Decide | `live` | Decide | `live` |
| `security` | Read | `proposals` | Read | `proposals` |
| `adoption` | Read | `proposals` | **Measure** | `overview` |
| `delivery` | Read | `proposals` (alias) | **Measure** | `overview` |
| `contributors` | Read | `proposals` | **Measure** | `overview` |
| `teams` | Read | `proposals` | **Measure** | `overview` |
| `practices` | Decide | `live` | Decide | `live` |
| `registry` | Connect | `repositories` | Connect | `repositories` |
| `skills` † | Apply | `repositories` | **Decide** | `live` |
| `memory` † | Apply | `repositories` | Apply | `executive` |
| `knowledge` † | Apply | `repositories` | Apply | `executive` |
| `surfaces` † | Apply | `repositories` | Apply | `executive` |
| `members` † | Connect | `repositories` | Connect | `repositories` |
| `governance` | Read | `proposals` | Read | `proposals` |
| `integrations` | Connect | `repositories` | Connect | `repositories` |
| `pairing` | Connect | `repositories` | Connect | `repositories` |
| `audit` † | Apply | `repositories` | Apply | `executive` |
| `settings` | Connect | `repositories` | Connect | `repositories` |

**Counts. 26 ids in each column, each exactly once.**

- Journey A — Connect 5, Scan 2, Read 10, Decide 3, Apply 6 = **26**.
- Journey B — Connect 5, Scan 2, Read 4, Decide 4, Apply 5, Measure 6 = **26**.

**What the operator's answer actually costs.** Only **7 of 26** ids change stage
between A and B: the six Bought-lane reads (`executive`, `digest`, `delivery`,
`contributors`, `teams`, `adoption`) move Read → Measure, and `skills` moves
Apply → Decide. The ADR estimated "roughly a third"; measured, it is 27 %. The
larger consequence is not the moved ids but the **shape of Read**: under A, Read
claims 10 of 26 tabs — it is not a stage, it is a second rail. Journey B's Measure
stage is what makes Read a four-tab stage with one question.

**Wave 1's size, measured.** Of 26 next-move edges, A already has 5 literal plus 2
via the alias, so wave 1 writes **19–21 new edges**; B has 4 literal plus 1 alias,
so **21–22 new edges**. The difference between the two journeys is 1–2 edges of
work. The choice is not a cost decision.

One measurement hazard wave 1 must not step in: `tech-stacks` and `delivery` link
to `followups`, not `proposals`. The graph treats `followups` as its own node, so
two edges that *functionally* land on the Decide entry are invisible to both pins —
`proposals` would read as un-reached while a user clicking from Tech Stacks does
arrive there. Either the link sites move to `proposals`, or the graph collapses the
alias. Doing neither leaves the back-measurement lying in the ADR's favour.

### 3. The tabs no stage claims

The same six ids under both journeys — which is itself the finding: the orphans
are not an artefact of the journey choice, so the operator's answer does not
dissolve them. Four are the Shared lane's reference tail, two are Admin rows.

| Tab | What it renders | Who links to it |
| --- | --- | --- |
| `skills` † | The org's skill roster with adoption, dormancy badges and API tokens (`src/features/shared/skills/SkillsTab.v1.tsx:1-12`). A library the *local agent* consumes, not a step a person takes. | **`registry` only** — inbound 1, outbound 0. |
| `memory` † | Coverage strip, the browsable Shared Org Memory store, Recall/Reflect (`src/features/shared/memory/MemoryTab.v1.tsx:1-14`). Same shape: an agent-side store with a human browser bolted on. | **Nobody.** Inbound 0, outbound 0 — isolated since the ADR was written. |
| `knowledge` † | The registry's knowledge lane as the registry structures it, plus fleet conformance per subject (`src/features/shared/knowledge/KnowledgeTab.tsx:1-16`). Explicitly "a mirror with a hand". | `registry`, `surfaces`. |
| `surfaces` † | The knowledge lane's `ui-surfaces` subjects rendered as live scenes (`src/features/shared/surfaces/SurfacesTab.tsx:22-30`, catalog at `catalog.ts:1-12`); `orgTabs.ts:183-185` calls it "reference about reference, with no fleet state at all". | **`knowledge` only** — and it links back. `knowledge` ⇄ `surfaces` is a closed two-node cycle with one entrance. |
| `members` † | The roster and, for an owner, invites and role changes (`src/features/admin/members/MembersTab.tsx:1-8`). Connect-time setup that a returning org never revisits. | **Nobody.** Inbound 0, outbound 0. |
| `audit` † | The searchable audit trail, 25 rows a page (`src/features/admin/audit/AuditTab.tsx:1-14`). A record of the loop, not a move in it. | **Nobody.** Inbound 0, outbound 0. |

Read as merge candidates, per the ADR's Decision point 2 ("either it belongs
behind another tab… or the stage set is wrong"):

- **`surfaces` behind `knowledge`.** The strongest candidate on evidence alone: one
  entrance, one exit, both to the same tab, and `orgTabs.ts:183-185` already
  documents it as a subset of the Knowledge base's own subjects. This is the
  `segments`-behind-`repositories` shape exactly.
- **`skills` + `memory` behind `registry`.** `registry` is already declared first
  in Shared because "the other three Library tabs read their source of truth from
  it" (`orgTabs.ts:173-175`). It is the one tab linking to `skills`, and the one
  that *should* be linking to `memory`.
- **`audit` behind `members`, or both behind `settings`.** Two isolated Admin rows
  with zero edges in either direction. Merging them does not cost a path of use,
  because neither is on one.
- **`knowledge`** stays a tab under either journey if `surfaces` folds into it; it
  is the only orphan with a real inbound edge from outside its own cluster.

A caution the ADR already earned: `followups` and the Plan/Backlog retirement show
merges work here, and Alternative B is still rejected as the *starting* move. These
are the evidenced candidates stages 1–3 were supposed to produce, not a mandate.

### 4. Drift the migration must retire

Four items, each a place where a shipped surface asserts a structure the code no
longer has. All four die with the migration described in Consequences; listing them
here so "done" is checkable.

1. **`loopSteps.ts` labels three of five steps with pre-W1a group names.**
   `module: "Govern"` (`loopSteps.ts:27`), `module: "Fleet"` (`:33`),
   `module: "Overview"` (`:39`). The live lanes are `standing` / `shared` /
   `inflight` / `bought` / `admin` (`orgTabs.ts:145-225`). Only steps 4 and 5
   (`module: "In flight"`, `:46` and `:52`) name a lane that exists. The page that
   teaches the loop sends a reader to a rail section the rail does not have.
2. **`proposals` is the target of two different verbs.** `loopSteps.ts:47` (Decide)
   and `loopSteps.ts:53` (Apply) both resolve to `tab: "proposals"`. Under either
   journey in §2 that is a contradiction: a tab is assigned exactly one stage, so
   the loop page currently claims one tab is two stages. Whichever journey wins,
   one of those two steps needs a different tab — `live` is the natural Apply
   target, and it is what §2 uses.
3. **The tour reaches 3 of 26 on-rail tabs.** `overview`
   (`tour/steps.ts:26`, `:42`, `:50`, `:58`), `repositories` (`:34`), `executive`
   (`:66`). Six steps, three destinations. Its own "The rail is the journey" step
   then describes **"Four questions… Standing, Chosen, In flight, Bought, plus
   Admin"** (`tour/steps.ts:62`) — "Chosen" is the group name W1a *replaced*, and
   `orgTabs.ts:167-170` says so in as many words ("`shared`, not `chosen`"). The
   step teaching the user to read the rail names a lane that is not on it, and
   miscounts the lanes as four.
4. **`followups` is a journey target in two tabs' source.** §2's hazard note:
   `tech-stacks` and `delivery` link to the alias. The alias stays (inboxes hold
   those URLs, `orgTabs.ts:17-18`), but a *new* link written as part of this
   migration must name `proposals`, and the two existing ones should be rewritten
   so the pins measure the path a user walks.

### What this addendum does not decide

Nothing. It does not pick a journey, change a stage set, move a link, or touch the
Status line. The two tables exist so that the open question is answered once, as a
choice between A and B, and the next wave can derive 19–22 link edges from the
answer instead of hand-picking them.
