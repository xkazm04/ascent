# Developer — UC3 "individual care" in the app

_Status: **consolidated (C1 complete)**. The prototype round is over: **Companion won**, the other two
directions are deleted, and the surface has moved from a `?tab=care` panel to the personalized route
`/org/developer`. The git-side half of the read model is **live** (the viewer's own slice of the
contributor snapshot + the open gaps of their repos); the care-loop half is still an honest empty state
until C3 ships the personal tables._

The Developer page is where UC3 lands in the product (design:
[`../../REGISTRY-AND-CARE-IMPL.md`](../../REGISTRY-AND-CARE-IMPL.md) §5, strategy:
[`../../GOLDEN-USE-CASES.md`](../../GOLDEN-USE-CASES.md)). The local `/mentor` skill is the **sensor and
coach** — it must run where the developer's sessions are, and transcript content never leaves the
machine. This page is the **memory, the map and the bridge**: it keeps the profile and journal across
machines, grounds moves in the standing of every repo the developer commits to, and turns a kept move
into a registry skill authored by the person who proved it.

## A route, reached from the header identity menu

`/org/developer` is a **static** App Router segment, so it wins over `/org/[slug]`. That is the whole
point: the page is personalized to the **authenticated viewer** and shows *their own* activity, never
someone else's — which a `?tab=` panel can never be, because a panel is org-scoped and anyone with org
access opens the same one.

**It left the org rail.** It used to sit last in the old `Chosen` group, which was structurally wrong:
the rail is org-scoped navigation, this page is not org-scoped at all, and a personal surface listed
beside Members and Audit reads as another org report. Its entry point is now the **header identity
menu** — your own login, present on every marketing page and every dashboard tab, in both auth stacks
(`src/components/header/IdentityMenu.tsx`, mounted by `HeaderAccount` in `src/components/Brand.tsx`).
The menu links `/org/developer` bare: the route resolves its own context, so no `?org=` is needed.
`developer` is now in `ORG_TABS_NOT_IN_NAV`.

It still renders the full dashboard chrome:

| Concern | How |
| --- | --- |
| Org context | `?org=<slug>` when the viewer may read it, else their first readable org (membership order), else their personal workspace (their login namespace), else the shared public org. **Every candidate passes `canReadOrg` before it is used**, so a hand-typed `?org=` cannot reach another tenant. |
| Header + rail | The page renders `OrgShell` (`src/components/org/shell/OrgShell.tsx`) — the body extracted verbatim out of `src/app/org/[slug]/layout.tsx`, which is now a thin call to it. Same guards, same waterfall, same empty states. |
| "You are here" | `OrgShell` takes `activeTab`, which it threads to `OrgTabNav` as `activeOverride`. `resolveActiveOrgTab` also resolves `/org/developer` by name, so the pure helper is honest on its own. |
| Links to it | `orgTabHref(slug, "developer")` → `/org/developer?org=<slug>`. `developer` is in `ORG_TAB_IDS` and `PERSONAL_TAB_IDS`, and deliberately **not** in `MIGRATED_ORG_TAB_IDS` and has **no `OrgTabChunks` branch**. |
| Legacy path | `src/app/org/[slug]/developer/page.tsx` redirects to `/org/developer?org=<slug>`. |

Sub-view switching inside the module is **React state, never a search param** (§5.3). The old `?demo=`
mechanism is gone: a "Preview as" control lives in `useState` inside the client `DeveloperHome`, and it
appears **only while the real view is blank** — a fixture is a dev/preview affordance, not a shareable
URL, and it always stamps a visible `preview · <state>` chip **and**, since 2026-09-05, holds a sticky
"Sample data - not your activity" banner (`CarePreviewBanner`) for the whole scroll with a way back
to the empty view, so the fixture cannot be mistaken for the viewer's own activity once the masthead
is out of view. The fixture module is imported on demand at the moment a preview is chosen; it is not
in the initial client bundle.

## What the page shows

One render, the Companion direction: a private notebook a calm colleague keeps for you.

- **Your activity here** — the git-side slice, led by `CareShareBar`: your AI-attributed share as a
  proportion of the commits it is a share *of*, then commits / AI-attributed / last active / champion
  as tiles. Read out of this workspace's contributor snapshot, **unfloored**, because the floors exist
  to stop the org reading a person, not to stop a person reading themself — the sentence that used to
  say so is now the section's `WhyChip`.
- **Profile card** (self-stated on your machine) · **what your laptop cannot see** — a `MatrixGrid`
  over two columns, *Mentor* and *Here*, whose voids are the argument: the mentor cannot hold your
  repo map, fleet evidence, the registry bridge, cross-machine memory or an anonymous baseline, and
  *Here* cannot hold your transcripts. The six counts below it are still read off the view model, so
  an empty workspace shows honest zeros; each one's rationale is in its `WhyChip`.
- **Moves board** — proposed / trying / kept / dropped, each with the journal evidence, the fleet
  evidence and an expected saving; "promote to registry" on kept moves. A move with no fleet evidence
  carries the `missing` void, not a weak-looking blank.
- **Session shape (30 days)** — one `Distribution` per shared count, with **your own value marked**
  against the org's p25→p75. See the four outcomes below; they are all visually distinct.
- **The repos you commit to** — and their open recommendations. A repo with no scan shows the `missing`
  void ("no scan"), never a "—" that could read as a floor score.
- **Journal** · **Setup + the privacy ledger** — see below. The ledger is now a picture.

### The privacy guarantee is drawn, not promised

The page used to carry the guarantee as copy: *"The mentor runs on your machine. This is what it is
allowed to send"*, *"Transcripts, prompts and diffs never leave your machine"*. A promise is the wrong
shape for a privacy claim — the reader has to trust it, and prose cannot enforce it. (It was not even
enforcing itself: "locked" was decided by `/never/i` over each row's *note*, which silently classified
`Per-person rows in org mode` — note "unrepresentable in the org view model" — as a switch the
developer had merely left off.)

`CarePrivacyLedger` is now a `MatrixGrid` on two axes:

| | **Sent** | **Switch** |
| --- | --- | --- |
| a count you share | measured (solid) | decided (ring) — your control |
| a count you left off | **void** | decided (ring) |
| transcripts · prompts, diffs · per-person rows | **void** | **void** — there is no control |

The bottom row is the invariant: nothing is sent **and** no switch exists that could send it, which is
the demoted sentence *"never leaves your machine — not a setting"* made checkable by a reader who does
not trust the copy. The locked rows are decided by `careNeverSent` (`src/lib/org/developer-view.ts`),
a named **set** of fields with the note match kept only as a second way in — not by a regex over
English. Two tests guard it and both **seed the violation**: `careLedgerRows.test.ts` and
`CarePrivacyLedger.dom.test.tsx` feed a ledger claiming transcripts *are* shared and assert the cells
stay empty (`data-mark` absent), while a switchable row does light up — so the guard is proving a
guard, not an empty render.

One consent sentence deliberately **stayed visible**: *"Proposed by your local mentor from your own
journal. Nothing here is assigned to you."* It is a use-constraint on a list of suggestions, no visual
encoding carries it, and the reader must meet it at the same moment as the content — so it sits on the
moves board itself, never in a hover. The UI holds up the other half: no checkboxes, no completion
affordance, no ordinal numbering, and the only verbs are the developer's own (keep, drop). This is the
same call Wave 1 made for *"not a to-do list for anyone"* on Contributors.

### Four absences that used to look alike

Every one of these is about the viewer themself, which is why the page cares more than any other tab.

| Situation | `activityState` | Encoding |
| --- | --- | --- |
| Your rows exist and the snapshot **suppressed** them (population `< CHAMPION_MIN_POP`) | `withheld` | hatch — *not judged*, plus "your commits exist" |
| The snapshot was read and you are genuinely not in it | `absent` | the `missing` void |
| The snapshot could not be read | `unreadable` | hatch |
| Nobody is signed in | `signed-out` | the void + an invitation |

`activity: null` carried all four and the page narrated them with one paragraph, so a **suppression**
read exactly like "you have never committed here". `DeveloperView.activityState` now names which, set
in `getDeveloperView` from `ContributorInsights.namingAllowed` — the same typed-state discipline as
`RepoConcentration.topLoginState` ("withheld" vs "unknown").

The session-shape strip carries the same discipline on four outcomes:

| Situation | Encoding |
| --- | --- |
| never shared | the `missing` void, and **no numeral at all** — so it can never be misread as a zero |
| shared, comparison off | the `decided` ring — your decision, not a shortage of data |
| shared, comparison on, no band for this field | the hatch — not judged |
| shared, band exists | the quartile strip, with your value marked |

And `CareShareBar` separates *no commits for a share to be a share of* (the void) from a **measured
0%** (an empty track beside a real zero) — the org-side `AiBar` fix from Wave 1, on the surface where
it is most personal.

## Relation to Contributors (§5.2)

Contributors is the **org's view of all developers**; this page is a **developer's view of themself**.
The line between them is enforced in two directions:

- Contributors carries a **"You" pointer**: if the viewer is in the roster, their table row and champion
  card carry a `you → developer` mark linking here; if not (never committed to a scanned repo, or the
  population is under the naming floor and no per-person rows exist at all), a quiet strip offers the
  same destination — absence from that table is normal and must not read as a deficiency.
- The former Care **org mode** now renders as a **Care section inside Contributors**
  (`ContributorsCareSection`), fed by `getCareOrgAggregate(slug)`. Adoption counts, most-kept moves,
  anonymized asks, shape bands and outcomes — all under `CHAMPION_MIN_POP`, suppressed rather than
  thinned below it. The guarantee is structural: `CareOrgView` has **no field that could hold a
  person**, and nothing per-person crosses from this page except through an explicit `share`.

## Files

| Piece | File |
| --- | --- |
| Types, constants, pure derivations | `src/lib/org/developer-view.ts` |
| Server loaders (`getDeveloperView`, `getCareOrgAggregate`) | `src/lib/org/developer-view-load.ts` |
| Fixtures (client preview only) | `src/lib/org/developer-view.fixture.ts` |
| Route | `src/app/org/developer/page.tsx` |
| Legacy redirect | `src/app/org/[slug]/developer/page.tsx` |
| Client root (preview state) | `src/features/developer/DeveloperHome.tsx` |
| The render | `src/features/developer/DeveloperCompanion.tsx` |
| Sub-components | `.../DeveloperActivityStrip.tsx`, `CareBits`, `CareCopyAction`, `CarePreviewBanner`, `CareProfileCard`, `CareMovesBoard`, `CareSessionShape`, `CareShapeRow`, `CareShareBar`, `CareRepoGaps`, `CareJournal`, `CarePrivacyLedger`, `CareWhyStrip`. Each renders exactly one layout since 2026-09-05; the Climb/Cockpit prototype branches are gone. |
| Privacy-ledger row model (pure) | `src/features/developer/careLedgerRows.ts` |
| Shared viz kit | `@/components/org/viz` — `MatrixGrid`, `Distribution`, `StateSwatch`, `Legend`, `WhyChip`. No state encoding, hatch, dash or legend is re-implemented in this directory. |
| Shared org shell | `src/components/org/shell/OrgShell.tsx` (+ `src/lib/org/orgShellGate.ts`) |
| Contributors relation | `src/features/bought/contributors/ContributorsYouPointer.tsx`, `ContributorsCareSection.tsx`, `CareOrgAggregate.tsx` |

`developer-view.ts` is deliberately **pure** (types + constants + helpers) with the `@/lib/db` reads
split into the `-load.ts` sibling, because the render is a client component and imports those helpers —
the same client/server boundary split as `skill-usage-load.ts`.

## Known gaps

- **The care loop has no data layer.** There are no `PersonalMentorProfile` / `MentorMove` /
  `MentorJournal` tables and no `POST /api/me/mentor/share` yet (C3), and no real floored org aggregate
  (C4 — `getCareOrgAggregate` returns the honest empty aggregate keyed on the real contributor
  population). The git-side half is live; nothing in the care half is fabricated.
- **Most actions are unwired.** Share, Install mentor, Mark kept/dropped, Promote to registry and
  "author as registry skill" `console.info` their intent; the PR-opening bridge to the registry lands
  with C4. The one exception since 2026-09-05: **"Copy `npx ascent mentor init`" really writes the
  clipboard** (`CareCopyAction`, with a selectable `<code>` fallback where the Clipboard API is
  absent), because a button labelled Copy is a promise about the clipboard. Both mentor commands
  render as selectable code.
- **The `/mentor` skill does not exist yet** (C2) — nothing can share to this page until it ships in the
  `npx ascent` distributable.
- (Closed 2026-09-08.) ~~Every absence on this page is narrated in one paragraph.~~ The four reasons
  `activity` is null are now a typed `activityState` and four distinct marks, the session-shape strip
  tells "not shared" / "comparison off" / "no band yet" apart, `CareShareBar` tells a missing
  denominator from a measured 0%, and the privacy ledger is a matrix with a void column guarded by two
  seeded-violation tests. `SectionHeader description=` in `src/features/developer`: **7 → 1**, and the
  survivor is a window/order (`"N entries · newest first"`).
- (Closed 2026-09-05.) ~~`myRepos` levels/scores are not populated.~~ The loader now reads
  `getRepoStates` (one query, in parallel with the backlog read, best-effort) for each repo's latest
  level and score; "—" appears only when a repo has no scan. A repo card with no open
  recommendations says "No open gaps." instead of rendering an empty list.
