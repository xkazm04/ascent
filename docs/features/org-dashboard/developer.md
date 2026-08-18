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

## A route, presented as a rail item

`/org/developer` is a **static** App Router segment, so it wins over `/org/[slug]`. That is the whole
point: the page is personalized to the **authenticated viewer** and shows *their own* activity, never
someone else's — which a `?tab=` panel can never be, because a panel is org-scoped and anyone with org
access opens the same one.

It still presents as a rail item ("Developer", last in the **Chosen** group), so the full dashboard
chrome stays available:

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
URL, and it always stamps a visible `preview · <state>` chip.

## What the page shows

One render, the Companion direction: a private notebook a calm colleague keeps for you.

- **Your activity here** — the git-side slice: commits, AI-attributed commits, your AI share, champion
  status. Read out of this workspace's contributor snapshot, **unfloored**, because the floors exist to
  stop the org reading a person, not to stop a person reading themself.
- **Profile card** (self-stated on your machine) · **why this lives here and not only on your laptop**
  (every line counted off the view model, so an empty workspace shows honest zeros).
- **Moves board** — proposed / trying / kept / dropped, each with the journal evidence, the fleet
  evidence and an expected saving; "promote to registry" on kept moves.
- **Session shape (30 days)** — only the counts you chose to share, with an optional anonymous org band.
- **The repos you commit to** — and their open recommendations, so a move can be grounded in more than
  the one working copy the local mentor can read.
- **Journal** · **Setup + the privacy ledger** — what is and is not allowed to leave the machine, stated
  in the negative and permanently.

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
| Client root (preview state) | `src/components/org/developer/DeveloperHome.tsx` |
| The render | `src/components/org/developer/DeveloperCompanion.tsx` |
| Sub-components | `.../DeveloperActivityStrip.tsx`, `CareBits`, `CareProfileCard`, `CareMovesBoard`, `CareSessionShape`, `CareRepoGaps`, `CareJournal`, `CarePrivacyLedger`, `CareWhyStrip` |
| Shared org shell | `src/components/org/shell/OrgShell.tsx` (+ `src/lib/org/orgShellGate.ts`) |
| Contributors relation | `src/components/org/fleet/contributors/ContributorsYouPointer.tsx`, `ContributorsCareSection.tsx`, `CareOrgAggregate.tsx` |

`developer-view.ts` is deliberately **pure** (types + constants + helpers) with the `@/lib/db` reads
split into the `-load.ts` sibling, because the render is a client component and imports those helpers —
the same client/server boundary split as `skill-usage-load.ts`.

## Known gaps

- **The care loop has no data layer.** There are no `PersonalMentorProfile` / `MentorMove` /
  `MentorJournal` tables and no `POST /api/me/mentor/share` yet (C3), and no real floored org aggregate
  (C4 — `getCareOrgAggregate` returns the honest empty aggregate keyed on the real contributor
  population). The git-side half is live; nothing in the care half is fabricated.
- **Actions are unwired.** Share, Install mentor, Mark kept/dropped, Promote to registry and "author as
  registry skill" `console.info` their intent; the PR-opening bridge to the registry lands with C4.
- **The `/mentor` skill does not exist yet** (C2) — nothing can share to this page until it ships in the
  `npx ascent` distributable.
- **`myRepos` levels/scores are not populated.** The loader fills repo names and their open
  recommendations; per-repo level/score would need a second rollup read and is deliberately left null
  (rendered as "—") rather than guessed.
