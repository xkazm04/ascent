# ADR 2026-09-14 — One path of use for the Org modules

**Status:** Accepted 2026-10-05 - journey B (operator sign-off, goal 4ab0f17f)
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

---

## Decision outcome 2026-10-05

The operator chose **journey B**: a first-run path Connect -> Scan, walked once, then a returning loop Read -> Decide -> Apply -> Measure -> back to Read.

- **Amends Decision point 1.** The stage set is six stages, not five verbs.
- **Stage assignment** is the addendum's section 2 Journey B column, unchanged: Connect 5 (registry, members, integrations, pairing, settings); Scan 2 (repositories, passports); Read 4 (overview, tech-stacks, security, governance); Decide 4 (proposals, lessons, practices, skills); Apply 5 (live, memory, knowledge, surfaces, audit); Measure 6 (executive, digest, adoption, delivery, contributors, teams). Total 26.
- **Next-move rule** is the entry tab of the next stage: Connect->repositories, Scan->overview, Read->proposals, Decide->live, Apply->executive, Measure->overview.
- **Section 3 merge candidates** stay undecided.
- **The code declaration** now lives in `src/lib/org/orgJourney.ts`.

---

## Rulings and retirement 2026-10-06

Recorded after wave 2 (9d8347df). Reconcile result: before this section the ADR held no record of the placement rules or of the section 4 retirements (the last ADR commit is 62ce87ae, the 2026-10-05 decision outcome). Everything below was verified against master at 9d8347df, not carried over from the run briefs.

### 1. Next-move placement rules

The shipped statement is the header comment of `src/components/org/shared/NextMoveLink.tsx:7-20`. The rules are decisions of this ADR, in that wording.

- **(A) The next-move link is always visible and unscoped.** A contextual, filtered or dim-scoped link to the same tab (a drill-in, a conditional banner, a detail-panel link) is a second route and never stands in for it.
- **(B) A "no data yet" state, where the next stage would be empty too, renders no forward link.** Its onward move is the stage that fills it: Security and Executive link to `repositories`.

Clarifications of B:

- A filter or search that empties the view is NOT "no data". It keeps the link.
- A catalog- or registry-backed tab (Surfaces, Practices, Skills, Memory) never is "no data". It keeps the link.
- A Connect tab is configuration and always shows its link, except in an unavailable state (no database, owner-only, role refusal).
- Live keeps its link in every `?view`, because the wall is a view of the Apply entry tab. Only TV mode, which fullscreens `<html>`, hides it (`src/features/inflight/live/LiveNextMove.tsx:5-12`).

### 2. Rulings from wave 1c (135bd9f6)

1. A Members viewer who is refused the read-only view gets no link. That is an unavailable state, like no database.
2. The old OrgEmpty "<- Org overview" back link in the `!rollup` branch of Repositories stays. It is a back link in a near-unreachable no-database / no-org state, not a next move.
3. The Scan predicate stands: `scannedCount > 0` OR an active segment/stack scope. A scoped view keeps the link, because under rule B an empty filter is not "no data".
4. The Integrations Prism drill-in keeps the link (rule A, always visible).

### 3. Section 4 drift, retired

Each commit below was found with `git log -S` / `git show` and its diff read.

| Item | Retired by | Evidence |
| --- | --- | --- |
| 1. Pre-W1a module labels in `loopSteps.ts` | 9d8347df | `loopSteps.ts` now maps `ORG_STAGES` to steps and takes each step's lane from `orgGroupLabelFor(stage.entryTab)` (`src/components/about-org/loopSteps.ts:39-43`), which looks the lane up in `ORG_NAV_GROUPS`. The hand-typed `Govern` / `Fleet` / `Overview` labels are deleted. |
| 2. `proposals` as the target of two verbs | 9d8347df | Decide enters on `proposals`, Apply on `live` (`ORG_STAGES` in `src/lib/org/orgJourney.ts`). The loop has six steps, and each steps to a distinct tab. |
| 3. The "Four questions ... Chosen" tour copy | 9d8347df | The `modules-nav` body in `src/components/onboarding/tour/steps.ts` now names Standing, Shared, In flight, Bought and Admin, and says each tab ends with a "Next:" link. |
| 4. `followups` links in tech-stacks and delivery | 98af2737 (wave 1a), before wave 1c | `PlaybookDetail.tsx` (tech-stacks) and `AiRoiQuadrantActions.tsx` (delivery) now link to `proposals` through `buildUrl`, keeping `dim`. The diff removes both `tab=followups` hrefs. The only remaining `followups` sites in `src/` are the redirect in `src/app/org/[slug]/page.tsx` and the alias declaration in `orgTabs.ts`. |

Item 3 has a second half, the tour reaching 3 of 26 on-rail tabs. **Ruling: that is not drift to retire.** The tour stays six steps. The path is walked through the "Next:" link every rail tab now ends on, and the `modules-nav` step says so.

Guard tests that stop each item recurring:

- `src/components/about-org/loopSteps.test.ts` (added in 9d8347df): items 1 and 2. One step per stage in order, no two steps on the same tab, `module` equals the label of the lane that holds the tab, and the loop returns to Read.
- `src/components/onboarding/tour/steps.test.ts` (added in 9d8347df): item 3. The `modules-nav` body names every lane the rail has, and contains neither "Chosen" nor "Four questions".
- `src/lib/org/tab-link-graph.test.ts`: the pins that every tab has an outbound link and the journey block that checks each tab links to `nextMoveFor(tab)` through a literal `NextMoveLink`. Item 4 is covered only indirectly: the journey block asserts each tab's outbound edges include `nextMoveFor(tab)`, which is never `followups`, but nothing in it fails if a new link to the `followups` alias appears. The guard for that is the comment at the top of `src/lib/org/orgJourney.ts`.

### 4. Back-measure, 2026-10-06

Measured on master at 9d8347df by running `src/lib/org/tab-link-graph.test.ts` (with `loopSteps.test.ts` and `tour/steps.test.ts`: 3 files, 88 tests, all passing; the pins in `tab-link-graph.test.ts` are asserted equal to the scan, so a pass is the measurement) and by reading `ORG_STAGES` and `ORG_TAB_STAGE` from `src/lib/org/orgJourney.ts` against `ORG_NAV_GROUPS` (6 stages; 26 on-rail tabs, every one assigned to a stage; stage sizes Connect 5, Scan 2, Read 4, Decide 4, Apply 5, Measure 6). The table in "How this gets back-measured" above is left as written.

| Metric | Section 1 table (then) | Measured 2026-10-06 | Target | Met |
| --- | ---: | ---: | ---: | --- |
| Tabs with no inbound link from a sibling | 10 | 8 (`digest`, `tech-stacks`, `passports`, `lessons`, `security`, `memory`, `members`, `audit`) | 0 | **No** |
| Tabs inside the declared journey | 5 of 27 | 26 of 26 on-rail | all on-rail | Yes |
| Tabs with no outbound link to a sibling | 9 | 0 (`NO_OUTBOUND` is `[]`; `followups` is the designed dead end and is not counted) | at most 1 | Yes |

The inbound target of 0 is NOT met. Waves 1a to 1c pointed every link at a stage entry tab (`registry`, `repositories`, `overview`, `proposals`, `live`, `executive`), and none of those was in the inbound gap list, so the count stayed at 8 across all three waves. The 8 remaining are the subject of the section 3 merge candidates, which stay undecided and go to the architecture review next.

### What this section does not decide

The section 3 merges, and any change of the stage set.

---

## Architecture review 2026-10-06 - the tabs with no inbound link

Dispatched after the back-measure above: the inbound target of 0 is the journey's one
unmet measure, and section 3's merge candidates were sent here. This section is an
analysis. It writes no link, folds no tab, and changes no stage.

### (a) The measurement

Command run on this branch's base, `master` at 3854ad69, in the worktree:

```
npx vitest run src/lib/org/tab-link-graph.test.ts
```

Result: **1 file, 81 tests, all passing.** The `NO_INBOUND` pin is asserted equal to the
scan of the real tree (`src/lib/org/tab-link-graph.test.ts:135`), so a pass **is** the
measurement. The pinned list (`tab-link-graph.test.ts:103`), in `ORG_TAB_IDS` order:

> `digest`, `tech-stacks`, `passports`, `lessons`, `security`, `memory`, `members`, `audit`

Eight, unchanged from the 2026-10-06 back-measure, and identical to the list the brief
predicted. `NO_OUTBOUND` is `[]` (`tab-link-graph.test.ts:111`): every on-rail tab has an
exit, so this section is about entrances only.

**The first finding is the shape of the list.** Journey B's six stage entry tabs are
`registry`, `repositories`, `overview`, `proposals`, `live`, `executive`
(`src/lib/org/orgJourney.ts:28-35`). **Not one of them is in the list**, and **none of the
eight is an entry tab**. That is not a coincidence: the next-move rule points every tab at
the entry tab of the next stage (`nextMoveFor`, `src/lib/org/orgJourney.ts:89-92`), so
waves 1a-1c could only ever have fed the six entries. The eight remaining are exactly the
**non-entry tabs that no sibling happens to mention** - the residue the next-move rule is
structurally unable to reach. Waves 1a-1c did not under-deliver; they delivered a rule
whose fixed points are the entry tabs.

The consequence for this review: the inbound gap cannot be closed by any further
application of the next-move rule. It needs either a *second* class of edge (a sibling
link) or fewer tabs (a merge).

### (b) The eight tabs

Stage and entry-tab columns are read from `ORG_TAB_STAGE` and `ORG_STAGES`
(`src/lib/org/orgJourney.ts:28-66`). "Out" is the tab's current outbound edge set as the
graph reports it; the entry-tab target in each set is its next-move link. "NO_INBOUND
after" counts the list shrinking as each row ships, in the table's order.

| Tab | Stage | Entry tab? | Rec | Source or host | Files a follow-up wave would touch | NO_INBOUND after |
| --- | --- | --- | --- | --- | --- | ---: |
| `digest` - the trailing 7 calendar days as one pasteable page, the Briefing's fixed-window sibling (`src/features/bought/digest/DigestTab.tsx:1-7`). Out: `executive`, `overview`, `proposals`. | Measure | No (`executive` is) | **L** | `executive`, the Measure entry tab - same stage | `src/features/bought/executive/ExecutiveTab.v1.tsx` (beside the next move at `:112`) and `ExecutiveTab.v2.tsx` (`:56`); both compositions, or the link is theme-conditional | 7 |
| `tech-stacks` - the stack x dimension heat matrix and the dimension analysis board (`src/features/standing/tech-stacks/TechStacksTab.tsx:1-2`). Out: `executive`, `practices`, `proposals`, `repositories`. | Read | No (`overview` is) | **L** | `overview`, the Read entry tab - same stage | `src/features/standing/overview/OverviewFleetPanel.tsx`, the fleet rollup both compositions render (`OverviewTab.v1.tsx:47`, `OverviewTab.v2.tsx:35`) - one edit covers both themes | 6 |
| `passports` - every scanned repo's two readiness axes, the automation x production scatter, the blockers docket (`src/features/standing/passports/PassportsTab.tsx:1-9`). Out: `overview`, `practices`. | Scan | No (`repositories` is) | **L** | `repositories`, the Scan entry tab - same stage | `src/features/standing/repositories/RepositoriesLeaderboardPanel.tsx` (the header region at `:59`, beside the next move at `:73`) | 5 |
| `lessons` - the loop agents' lesson candidates as a decision ledger (`src/features/inflight/lessons/LessonsTab.tsx:1-6`). Out: `live`. | Decide | No (`proposals` is) | **L** | `proposals`, the Decide entry tab - same stage | `src/features/inflight/proposals/ProposalsTab.tsx` (beside the next move at `:88`) | 4 |
| `security` - one dense risk register: D9 per repo, gate verdict, branch rules, advisories, findings (`src/features/standing/security/SecurityTab.tsx:1-5`). Out: `proposals`, `repositories`. | Read | No (`overview` is) | **L** | `overview`, the Read entry tab - same stage | `src/features/standing/overview/OverviewFixFirstPanel.tsx` (the panel header, rendered at `OverviewTab.v1.tsx:43` / `OverviewTab.v2.tsx:46`) | 3 |
| `memory` - the coverage strip, the browsable Shared Org Memory store, Recall/Reflect (`src/features/shared/memory/MemoryTab.tsx:1-3`). Out: `executive`. | Apply | No (`live` is) | **L** | `knowledge`, a named sibling in the **same stage** (Apply). Not `registry`: that is section 3's host and it is Connect - see (d) | `src/features/shared/knowledge/KnowledgeTab.tsx` (beside the next move at `:103`) | 2 |
| `members` - the roster, and for an owner invites and role changes (`src/features/admin/members/MembersTab.tsx:1-6`). Out: `repositories`. | Connect | No (`registry` is) | **L** | `settings`, a named sibling in the **same stage** (Connect). Semantically closer than the entry tab: Registry maps a git repo, Settings administers the org | `src/features/admin/settings/SettingsTab.v1.tsx` (`:43`) and `SettingsTab.v2.tsx` (`:60`); both compositions | 1 |
| `audit` - the searchable audit trail, 25 rows a page (`src/features/admin/audit/AuditTab.tsx:1-2`). Out: `executive`. | Apply | No (`live` is) | **L** | `live`, the Apply entry tab - same stage. The record of what the runner did, linked from where it is doing it | a co-located sibling of `src/features/inflight/live/LiveNextMove.tsx:10-16`, so the link reaches all four `?view=` views at once rather than one of them | **0** |

Every row is **L**. No row is **M** and no row is **K**: none of the eight is isolated in a
way a merge is needed to resolve, and keeping any of them unreachable from a sibling is
exactly the state the ADR's own back-measure calls unmet.

**How each link complies with the two rules** (`src/components/org/shared/NextMoveLink.tsx:10-19`):

- **Rule A.** Each of these is a **second route**, not a next move. It never replaces the
  host's `NextMoveLink`, which stays always-visible and unscoped where it already is. The
  practical form: a plain `<Link href={orgTabHref(slug, "<id>")}>` in the host's content,
  **never** a `<NextMoveLink>`. The journey render-site pin matches the literal
  `<NextMoveLink href={orgTabHref(x, "t")} to="t" />` (`tab-link-graph.test.ts:83-84`), so
  writing a sibling link with that component would make a second thing look like a stage
  move to the measurement.
- **Rule B.** Each link sits in the host's **data branch**, beside or below the existing
  content, never in its "no data yet" branch. Where the host has a Scan-entry empty state -
  Security and Executive both do (`tab-link-graph.test.ts:247`) - that branch is untouched,
  so an empty Briefing still points at `repositories` and gains no link to an equally empty
  Weekly digest.
- One consequence for the wave, not for the rules: `NO_INBOUND` at
  `tab-link-graph.test.ts:103` is the measurement, so each shipped link also shrinks that
  array by one name. An edit that makes the suite pass **by widening the list** is the
  failure mode the pin's own comment warns about.

**Exactly one of the eight crosses a nav group:** `live` (In flight) -> `audit` (Admin).
That is allowed - the lanes are the questions, the stages are the order (Decision point 4) -
but it is named here so it is a decision and not a surprise. The other seven stay inside one
lane, which is its own small evidence that the stage set and the lanes agree more than the
addendum's `†` marks suggest.

**One row is already half-true and must not be double-counted.** `security` has a
*conditional* inbound edge from Overview's Fix-first punch-list, which links to whichever
findings module is busiest (`src/features/standing/overview/fixFirst.ts`, declared as a
dynamic site at `tab-link-graph.test.ts:119`). The graph does not count it, correctly - "a
link that exists only on some days is not a path of use". The **L** row above makes that
edge unconditional; it does not invent a relationship that was not there.

### (c) What ships buys

| If this ships | NO_INBOUND | On-rail tab count |
| --- | ---: | ---: |
| Nothing (today, 3854ad69) | 8 | 26 |
| Every **L** row in (b) | **0** | 26 |
| Every **L** row and every **M** row in (b) | **0** | 26 |

The two numbers are the same because **(b) contains no M row**. That is this review's
headline: **the inbound target of 0 is reachable entirely with link-only changes inside
the already-accepted stage set.** No merge is required to meet any measure this ADR
declared. Every merge still on the table is therefore a **tab-count and legibility**
decision, argued on its own merits, and never a connectivity one.

For completeness, if the section 3 merges were *also* taken in their re-hosted,
same-stage form (see (d)) - all four of them - the on-rail count would fall 26 -> 22 and `NO_INBOUND` would
stay 0 - the merged tabs leave the on-rail set, which is why a merge can never raise the
number.

### (d) Section 3's merge candidates, re-tested against journey B

The addendum's section 3 predates the journey choice. Re-reading its four candidates
against `ORG_TAB_STAGE` (`src/lib/org/orgJourney.ts:39-66`):

| Candidate, as section 3 wrote it | Tab's stage | Host's stage | Crosses? |
| --- | --- | --- | --- |
| `surfaces` behind `knowledge` | Apply | Apply | **No** |
| `skills` behind `registry` | **Decide** | **Connect** | **Yes - two stages** |
| `memory` behind `registry` | **Apply** | **Connect** | **Yes - two stages** |
| `audit` behind `members`, or both behind `settings` | **Apply** | **Connect** | **Yes** |

Three of the four cross. And they cross toward the same host lane, which is the finding:
section 3 clustered by **provenance** - what the registry distributes, who administers the
org - while journey B assigns by **what the user is doing**. Those are different axes, so
three candidates that read as obvious under the first read as stage violations under the
second.

Does that kill them, or is the stage set wrong? Both readings are available and only the
operator can pick:

- **The candidates are not killed, they are mis-hosted.** Each has a same-stage host that
  keeps the merge's substance: `skills` behind `practices` (both Decide, both
  registry-distributed artifacts a decision is taken about), `memory` behind `knowledge`
  (both Apply, both registry-backed stores the agent consumes), `audit` behind `live` (both
  Apply, the record and the act). Re-hosted, all four merges are same-stage, and shipping
  all four takes the on-rail count 26 -> 22.
- **Or the stage set is wrong for these ids.** The addendum marked `skills`, `memory`,
  `knowledge`, `surfaces`, `members` and `audit` with a `†`: placed **by elimination**,
  because no stage's verb describes what they render. Journey B did not dissolve that - it
  distributed the same six orphans across Connect, Decide and Apply. A merge that wants to
  cross a stage is, in substance, the argument that the elimination placement was wrong and
  these ids are **reference and record**, not steps. The honest version of that argument is
  not four merges; it is a seventh category, which is a stage-set change and re-opens the
  2026-10-05 decision.

This review does not pick between those. It records that **the choice is between re-hosting
the merges inside journey B and adding a stage**, and that doing neither leaves section 3's
candidates permanently unactionable - which is the state they have been in since
2026-10-05.

One candidate is unaffected by all of it: `surfaces` behind `knowledge` is same-stage,
has the one-entrance-one-exit evidence section 3 recorded, and is not in `NO_INBOUND`
(`knowledge` already links to it). It can be decided on its own, at any time, and nothing
in this section depends on the answer.

### (e) What an App Master may dispatch, and what only the operator may decide

**Dispatchable now - link-only, inside the accepted stage set, each reversible by deleting
one line.** None changes the tab count, the stage set, or any tab's scope. They are the
eight **L** rows in (b), and the suggested wave split follows the stage, the way waves
1a-1c did:

1. **Read and Measure:** `overview` -> `tech-stacks`, `overview` -> `security`,
   `executive` -> `digest`. (3 edges, 4 files.)
2. **Scan, Decide and Apply:** `repositories` -> `passports`, `proposals` -> `lessons`,
   `knowledge` -> `memory`, `live` -> `audit`. (4 edges, 4 files.)
3. **Connect:** `settings` -> `members`. (1 edge, 2 files - both compositions.)

Each wave also edits `NO_INBOUND` at `src/lib/org/tab-link-graph.test.ts:103`, downward.
After wave 3 the array is empty and the ADR's third back-measure row is met.

**Operator-only - these change the tab count or a tab's scope.**

- Whether to merge `surfaces` behind `knowledge` (same stage; the strongest evidence).
- Whether to re-host section 3's three cross-stage merges inside journey B
  (`skills`->`practices`, `memory`->`knowledge`, `audit`->`live`), or to drop them.
- Whether the six `†` ids are mis-staged and journey B needs a seventh category for
  reference and record - a stage-set change, and a re-opening of the 2026-10-05 decision.

### What this section does not decide

Nothing about tab count or stage set. It picks no merge, adds no stage, moves no id between
stages, and writes no link. It records one measured list, one recommendation per member of
that list, and the evidence that section 3's candidates were argued on an axis journey B
does not use. The inbound target of 0 is shown to be reachable without a single merge; the
merges therefore stand or fall on legibility, and that argument is the operator's to settle,
not this review's.
