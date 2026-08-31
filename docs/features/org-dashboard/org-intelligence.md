# Organization intelligence

Organization intelligence is Ascent's multi-repo, persistence-backed layer (Phase 2). It
rolls scan results across a whole org into fleet-wide views: maturity rollups, trends and
a forecast, movers, gap analysis, a repo leaderboard/heatmap, contributor and delivery
signals. It also adds a management layer (goals, initiatives, a what-if simulator) plus an
audit trail. It answers the leadership question the per-repo report can't: *"is our whole
org becoming AI-native, where are the gaps, and what's the highest-leverage move?"*

Everything here requires `DATABASE_URL`; without it the org pages show an empty/notice
state. When auth is configured, org pages are scoped to installations the viewer can read
(see [../auth.md](../github/auth.md)). The planning surface (goals / initiatives / simulator) has
its own doc: [plan.md](../org-planning/plan.md).

## Navigation & org context

`/org` (`src/app/org/page.tsx`) redirects to the active org's dashboard. Each
`/org/[slug]/*` page renders inside `src/app/org/[slug]/layout.tsx`, which centralizes the
DB/auth/empty guards and the org header, and shows the persistent nav rail
(`src/components/org/shell/OrgTabNav.tsx`), a two-level `SectionRailNav`: an icon rail of
module groups beside a panel holding only the selected group's pages. The active org is
chosen via `OrgSwitcher` (`src/components/OrgSwitcher.tsx`), persisted through
`POST /api/org/active` into the `ascent_active_org` cookie; `getActiveOrg()` reads it
(falling back to the first installation or `public`).

The same nav definition renders a filtered subset for a PERSONAL workspace
(`Organization.kind === "personal"`): only Overview, Security, Follow-ups, Skills and Memory,
since fleet aggregation/attribution surfaces need a real org's breadth.

**A tab switch never scrolls the page (2026-08-19).** Two things have to hold together for this.
`OrgTabNav` pushes the new `?tab=` with `{ scroll: false }`, so Next doesn't reset the scroll
position — and its a11y effect focuses the `<main>` landmark with `focus({ preventScroll: true })`.
Without the second half the first half is useless: `<main>` is taller than the viewport and starts
below the org header, so a bare `.focus()` made the browser scroll it up to the top of the
scrollport. The page appeared to scroll itself down a moment after each tab rendered (worst on the
tall tables — Follow-ups, Repositories), and the sticky left rail was dragged up to its `top-20`
perch along with it, so the nav looked like it moved on every click. Treat the rail's position as
purely declarative: nothing in the shell may scroll it, focus into it, or read/write `scrollTop`.

### The rail is grouped by the journey, not by data type (W1a, 2026-08-14)

The five module groups in `ORG_NAV_GROUPS` (`src/lib/org/orgTabs.ts`) are the four questions a
transformation owner is asked in a leadership meeting, plus an admin tail:

| Section | Answers | Tabs |
| --- | --- | --- |
| **Standing** | Where are we, honestly? | Overview · Follow-ups · Repositories · Tech Stacks · Passports · Security · Adoption · Governance |
| **Shared** | What do we publish once and every repo consumes? | Registry · Practices · Skills · Memory · Knowledge base |
| **In flight** | What is moving right now? | Live |
| **Bought** | What did the last period buy us? | Briefing · Delivery · Contributors · Teams |
| **Admin** | The boring rows, deliberately not hidden. | Members · Integrations · Audit · Settings |

This replaced the original six data-type modules (Overview · Fleet · Intelligence · Plan ·
Library · Govern). Rationale in [`docs/AI-SDLC-COMPANION-PLAN.md`](../../AI-SDLC-COMPANION-PLAN.md)
§Wave 1: a nav grouped by data type reads as a filing cabinet and answers no question anyone is
actually asked. **Nothing about the tab universe changed**: every id, href and legacy redirect is
untouched; this is a regrouping and relabelling of the module layer only. "In flight" is
deliberately the smallest group, because the loop is the product and it used to sit third-of-four
inside "Fleet".

`/about-org`'s public module map (`src/components/about-org/orgModules.ts`) derives from the same
constant, so it re-grouped itself; only the per-group icons needed remapping.

### The transition programme (W1c, 2026-08-14)

The org's **named, dated commitment**: one row per org (`TransitionProgram`, `orgId` unique),
managed from the **Programme** panel on the Briefing tab (moved there when the Plan tab retired, 2026-08-17), and read as a one-line strip under
the org header on **every** tab (`src/components/org/shell/ProgramStrip.tsx`):

> *Week 7 · Agent-ready by Q1 · L3 → L4 · 4 of 11 repos at target · +10 since baseline · 2 PRs in
> flight · +17 pts bought · next review in 5 days*

Onboarding's checklist ended at "invite a teammate", which is exactly where the job starts.
Everything after it was stateless: the dashboard could say where the fleet stood but never *where
are we in something*. The programme is that thread, and it is the checklist's new sixth step
(`program`, member-gated, org-only), so it is discovered through the onboarding companion rather
than through a banner.

**The frozen baseline is the point.** `baselineJson` is captured server-side, once, at creation, and
never rewritten. Port's AI-SDLC rule is *baseline before you turn anything on*, and a baseline
recomputed from today's data moves with the thing it is meant to measure. The client cannot supply
it (a caller who could set the origin could move it), and **re-targeting deliberately does not
re-baseline**: renaming a programme or shifting its date must not erase every measurement since the
start. An org that starts a programme before its first scan stores a **null** baseline: an honest
absent origin, not a zeroed one that would make the first scan read as pure progress.

**What the strip refuses to say.** Each segment is independently conditional, and absence is the
honest rendering of every unknown: movement appears only when both ends exist; *"N pts bought"*
appears only when the [Impact ledger](#impact-ledger--what-the-loop-bought-w1d-2026-08-14) has
**verified** points behind it (this is why W1c was sequenced after W1d); "next review" disappears
once the programme is paused or achieved; the target countdown is omitted entirely for an
open-ended programme. A strip that padded those with zeroes would be a gimmick.

**Cost.** `getOrgProgramStatus` is React-`cache()`d and composed from reads the shell already makes:
`getOrgHeaderSummary` (which gained a `levelCounts` tally folded into its existing pass, so
"N of M repos at target" costs no extra query), `countInFlightPrs`, and one indexed ledger read. It
does not reintroduce the rollup tax "Shell cost discipline" removed. `getOrgProgramStatus` failing
degrades the strip away, never the dashboard.

**API:** `GET|POST|PATCH|DELETE /api/org/program`: reads are `requireOrgRead`, writes
`requireOrgAccess`.

### Landing: what a bare `/org/<slug>` opens on (W1b, 2026-08-14)

The bare org URL is a **landing decision**, not a synonym for the Overview tab
(`resolveLandingTab`, `src/lib/org/landing.ts`, pure and unit-tested):

- no completed scan yet → **Overview**. Nothing is in flight, and the baseline is the job.
- a loop running (≥1 `ImprovementPr` in state `open`) → **Live**. Work is open on the org's behalf.
- scanned, nothing open → **Overview**. The fleet read is the right resting state.

The backlog deliberately does *not* count: an item sitting in the backlog is a decision not yet
taken, and landing someone on a to-do list every visit is nagging, not companionship. Only a PR the
org already said yes to earns the landing slot.

Two consequences worth knowing:

1. **`?tab=overview` is now explicit and is no longer normalized away.** `buildUrl` used to collapse
   it into the bare URL; with a conditional landing that would make Overview permanently unreachable
   (rail click → bare URL → landing → Live). `/org/<slug>` means "take me to this org";
   `/org/<slug>?tab=overview` means "the Overview tab".
2. **The shell threads the resolved landing tab into the rail** (`OrgTabNav`'s `landingTab` prop →
   `resolveActiveOrgTab`'s third argument), so the rail lights the panel the page actually rendered
   instead of always assuming Overview.

The decision reads one extra indexed count (`countInFlightPrs`, `@@index([orgId, state])`),
React-`cache()`d so the layout's call and the page's call collapse into one query. It renders rather
than redirects, so the bare URL stays shareable: it is the URL in the weekly digest email, and the
next person to open it may have different loop state.

**Getting there (2026-08-03).** The personal workspace's front door is `/me`
(`src/app/me/page.tsx`), which resolves the signed-in login and redirects to `/org/{login}`, an
`Organization` with `kind: "personal"`, auto-claimed on first visit by the identity-bound
personal-namespace seed in `src/lib/authz.ts` (login === slug, so nobody can claim a victim's
namespace). A viewer with **no** organization is coherent by construction: the claim creates their own
workspace, and the org layout renders a zero-repo personal org's shell: its add-repo form *is* the
empty state.

**The zero-repo wall fell for members (W6b, 2026-08-12).** The layout's empty-org decision is now the
pure `resolveOrgShellState` (`src/lib/org/orgShellGate.ts`, pinned by its co-located test):
a **member's** zero-repo fleet org renders the FULL shell: org header (alerts · credits · scan) +
rail + tabs, with a first-scan empty state in the content slot (`OrgFirstScanEmpty`: "Your dashboard
is waiting for its first scan" → `/onboarding`), instead of the old "No data for &lt;slug&gt;" wall.
The wall remains for non-members on an empty org (an outsider still can't distinguish "exists,
empty" from "no data yet") and for slugs with no org row at all; the DB-unreachable and
no-`DATABASE_URL` gates are unchanged. Membership is resolved via `resolveViewerLogin` across both
auth stacks (this also fixed the header role chip never resolving under the Supabase wall). The tour
drawer is skipped in the first-scan state, because its anchors don't exist yet.

**Preview-then-upgrade auto-start (W6b).** The header's `useOrgScanButton` consumes a one-shot
sessionStorage flag written by the onboarding wizard's "fast preview first" run
(`src/components/onboarding/upgradeScan.ts`: org-scoped, 15-min TTL, removed before the run starts so
a refresh can never re-trigger) and starts the LIVE scan of exactly the just-previewed repos through
the existing header stream: same meter, same credit disclosures/refusals, same server gates
(`requireOrgAccess`, `checkScanEntitlement`, per-repo reservation). Because the stream lives in the
layout, it survives `?tab=` navigation while `persistScanReport`'s engine-aware dedup upgrades the
preview (mock-engine) rows in place; mock provenance stays disclosed wherever rows render engine
labels (the "mock placeholder" convention in the Overview rollup / Clearance cards) until the live
rows land. See [the wizard doc](../onboarding/wizard.md) for the wizard half.

`/me` is now reachable from **every** page: the header's signed-in identity
(`IdentityLink` in `src/components/Brand.tsx`, rendered by `HeaderAccount`, which both `SiteHeader`
and `OrgHeader` mount) links to it. Previously it did not: under the ACTIVE Supabase login the
identity was an unlinked `<span>`, and only the DORMANT custom-OAuth branch linked it: to `/connect`,
the GitHub-App install flow, which is not a workspace. The two branches now share ONE `IdentityLink`
with one destination rather than a second, differently-behaving link being added beside the dead one.
`/me` resolves identity with `resolveViewerLogin` (custom-OAuth session › Supabase/dev viewer), the
same cross-stack precedence the org layout uses, so the link works from whichever stack rendered it;
under the Supabase wall `getSession()` is null and this collapses to the viewer, unchanged. Pinned by
`src/components/Brand.test.tsx` and `src/app/me/page.test.ts`.

| Group | Tab | Route | Main source dir | What it shows |
| --- | --- | --- | --- | --- |
| Standing | Overview | `org/[slug]?tab=overview` | `src/features/standing/overview/` | The **Fix first** band (up to 3 triage-ordered next moves: worst regresser, busiest unresolved findings queue, behind-pace goal; own Suspense boundary, `OverviewFixFirstPanel`), then four sections, top to bottom, **all off one `getOrgRollup` read**: the standing strip (maturity + level band, adoption, rigor, repos scanned, each with its cohort-matched period delta (`OrgRollup.movement` carries that delta **with** its matched-cohort size and the excluded composition change — `deltas` is the deprecated bare triple), plus the maturity trend as an inline sparkline) · posture distribution + the **dimension ledger** (per-dimension averages grouped by SDLC phase, each row a status word, a reading and two named affordances — see *The Overview ledger* below) · the Fleet category rollup (repos grouped by Type/Stack/Level; **Level groups are ordered L1→L5**, Type/Stack strongest-first) · the repo × dimension heatmap, whose cells open the per-dimension drill-in (`RepoDimensionModal`, on the brand `Modal` portal, `reading` width; summary rendered as markdown-lite via `MarkdownLite`, gaps as a list; "Next steps" says *nothing owed* for a green-band dimension and *not on record, re-scan* for a below-green one). The whole region is one client component, `OverviewLedger`, fed serialised data by the server `OverviewFleetPanel`. |
| Standing | Repositories | `org/[slug]/repositories` | `src/app/org/[slug]/repositories/page.tsx` | The repo **leaderboard** first (level/overall/adoption/rigor/posture/last scan + repo × dimension heatmap), then the **Context half-life** panel (W4, see below). Also renders **Segments** as its `?tab=segments` view (see below); there is no separate rail item or route for Segments anymore. |
| Standing | Tech Stacks | `org/[slug]/tech-stacks` | `src/app/org/[slug]/tech-stacks/` | Tech-stack breakdown across the fleet: per-stack maturity profiles and the **dimension analysis** board (see below). |
| Standing | Passports | `org/[slug]/passports` | `src/features/standing/passports/` | Repo passports, as three switcher views: **Baseline** (the automation × production portfolio), **Clearance** (the passport as a per-repo security clearance), and **Capabilities** (the declared-vs-proven capability matrix), and **Controls** (the per-check doctor findings each repo's own CI reported back) — both below. |
| Standing | Security | `org/[slug]/security` | `src/features/standing/security/` | Security posture across the fleet, in three stacked pieces: the summary-tile ledger (avg D9 · branch protection · repos at risk · gate), whose bottom edge **is** the D9 band spectrum (`SecurityBandSpectrum`, a `col-span-full` ledger cell — see below); the **D9 check battery** (`SecurityRiskRegister`; renamed from "Control matrix" 2026-08-31, MC-B10); and **Findings to decide** (`SecurityFindings`, see below). |
| Standing | Adoption | `org/[slug]/adoption` | `src/features/standing/adoption/` | Adoption signals: AI-share tiles, the contributor spread bar, tool footprint, champions, per-team adoption and the delivery strip. **Rates, bands and teams — no named per-person roster**; the "Who to enable next" table moved to Contributors (2026-08-19) and the spread bar's "none" follow-up deep-links across to it. |
| Standing | Follow-ups | `org/[slug]?tab=followups` | `src/components/org/followups/` | Every open gap across the fleet in one ledger — tick a batch, one fix prompt for a local agent, hand off, and the next default-branch scan closes what landed. Replaced the **Plan** and **Backlog** tabs (retired 2026-08-17). See [org-followups/README.md](../org-followups/README.md). |
| Shared | Practices | `org/[slug]/practices` | `src/app/org/[slug]/practices/page.tsx` | The Practice Library (see [../practices.md](./practices.md)). |
| Shared | Skills | `org/[slug]/skills` | `src/app/org/[slug]/skills/` | Skill drift/dormancy views. |
| Shared | Memory | `org/[slug]/memory` | `src/app/org/[slug]/memory/` | Shared Org Memory browser. |
| Shared | Knowledge base | `org/[slug]?tab=knowledge` | `src/features/shared/knowledge/` | Overview of the Reference Knowledge Bundles the registry publishes under `knowledge/<domain>/`, counted per domain across the three layers that ship (Golden Path → Technique → Application; Evidence is consumer-side and is deliberately not counted). Unmapped/empty/error registries each get their own notice rather than a zeroed table. Born inside the `?tab=` shell, so unlike its Shared siblings it has **no** `/org/[slug]/knowledge` route — which is exactly why its id must sit in `MIGRATED_ORG_TAB_IDS`: a tab outside that set is redirected by `/org/[slug]/page.tsx` to a legacy path it never had (it shipped that way on 2026-08-19 and 404'd the rail link; `orgTabs.test.ts` now asserts every un-migrated tab owns a real route). The counts are still `provisional` — the registry indexer walks skills/practices/memory and does not parse `knowledge/**` yet, so the view says so in the UI. |
| — (header menu) | Developer | `/org/developer` | `src/features/developer/` | UC3 individual care. Reached from the **header identity menu** (your own name), not from the org rail — it is not org-scoped, so it is in `ORG_TABS_NOT_IN_NAV`. Not a `?tab=` panel either: a static route personalized to the signed-in viewer (their commits and AI share, the open gaps of their repos, their private care loop). It renders the same `OrgShell` as every tab, with `activeTab="developer"`. The anonymized org aggregate lives in Contributors, under `CHAMPION_MIN_POP`, never a per-person row — see [developer.md](developer.md). |
| Standing | Governance | `org/[slug]/governance` | `src/features/standing/governance/` | Governance rollups: gate tiles, the editable policy card, fail-reasons, failing repos, the CI snippet, the evidence pack, and the AI stance section. No standfirst under the title, and no "Cheapest path to green" card (both deleted 2026-08-19 — see below). |
| In flight | Live | `org/[slug]/live` | `src/app/org/[slug]/live/` | Live/war-room view. |
| Bought | Briefing | `org/[slug]/executive` | `src/app/org/[slug]/executive/` | Executive briefing view. |
| Bought | Delivery | `org/[slug]/delivery` | `src/app/org/[slug]/delivery/page.tsx` | PR signals, branch governance, 12-week fleet commit activity, and (2026-07-28) a **Delivery-over-time** section: nine small-multiple day-by-day panels (review coverage, AI involvement, AI PRs reviewed, protected default branch, merge rate, small PRs, revert rate, time to first review, time to merge) plus gated slope reads, scoped by the shared org period selector. **W1a (2026-08-12)** surfaced three metrics every scan already persisted (`revertRate`, `medianHoursToFirstReview`, `smallPrRate`) into the signal band, the per-repo table, the trend, and a **review-latency slope** (`hoursToFirstReview` in `DELIVERY_FIT_METRICS`, hours/week with inverted goodness tone): the review-capacity read behind the Assist→Delegate bottleneck. Because the metrics come from the historical `prStats` blobs, the trend back-filled from existing scans day one; a blob written before the fields existed reads null ("not in these scans"), never a fabricated 0. **W2 (2026-08-12)** added two trailer-era attribution metrics from the extended `PR_QUERY` (merge-commit + PR-commit messages, review-author `__typename`): `aiTrailerRate`: share of merged PRs whose commit messages carry an AI attribution trailer (trailer-GROUNDED attribution, vs the self-declared marker rate); and `aiPreReviewedRate`: share of merged PRs an AI/bot reviewer (CodeRabbit, Copilot code review, Greptile, …) reviewed before the first human review. Both surface in the signal band (now 10 cells), the per-repo table, and two new trend panels; both are null on pre-W2 blobs and under the ≥5 merged-PR floor. The AI-delivery ROI model (`aiDeliveryModel.ts`) prefers trailer-grounded counts as its **allocation weight** where present (a commit trailer is tooling-written evidence; markers are self-declared), refining the "allocated" fidelity tier only, complementing (never replacing) the measured per-repo OTel path. "Fix first" adds two derived priorities: a slow first review (>24h, called out against AI PR share) and a fleet revert rate ≥5%. **W5 (2026-08-12)** added `reworkRate` (share of merged PRs later reverted, from revert linkage) to the delivery-trend point keys on the same null-back-fill discipline (data only so far, no dedicated panel yet); the metric's home surface (the Backlog tab's Debt Ledger) retired 2026-08-17 — `getOrgRework` is currently an orphaned read awaiting a Delivery-tab home. Its five rollup queries (PR signals, governance, activity, AI usage, delivery trend) run via `Promise.allSettled`, not `Promise.all`: one query erroring degrades only its own panel (an explicit "couldn't load" banner, not a silent empty state), instead of blanking the whole tab. |
| Bought | Contributors | `org/[slug]/contributors` | `src/features/bought/contributors/` | AI champions, involvement table (withheld below 3 contributors), **Who to enable next** (`EnablementTargets`, moved here from Adoption 2026-08-19 — see below), an **Org resilience** module (fleet key-person exposure, repo-level only, names nobody), and the per-repo concentration / bus-factor table. |
| Bought | Teams | `org/[slug]/teams` | `src/app/org/[slug]/teams/page.tsx` | Per-team (CODEOWNERS) Adoption×Rigor, dimension shape, AI-knowledge & champions, movers; the org's AI-knowledge leader + a suggested cross-team pairing. |
| Admin | Members | `org/[slug]/members` | `src/app/org/[slug]/members/` | Membership + roles. |
| Admin | Integrations | `org/[slug]/integrations` | `src/app/org/[slug]/integrations/` | Connect AI coding providers: Claude Code (measured, OTel push) and Copilot (seats-only, admin pull); OpenAI staged as planned. See [Provider integrations](#provider-integrations-orgslugintegrations-owner-only). |
| Admin | Audit | `org/[slug]/audit` | `src/app/org/[slug]/audit/page.tsx` | Searchable, keyset-paginated audit trail. |
| Admin | Settings | `org/[slug]/settings` | `src/app/org/[slug]/settings/` | Org-level settings. |

### The Overview ledger (2026-08-17)

The Overview is the org's first point of contact. Its old dimension grid showed nine bars with a
number each and a label that silently linked to a practice card — numbers without a reading, and
clicks without a stated destination. It was redesigned through a two-direction prototype round
("Ledger", an editorial balance sheet read top-to-bottom, vs "Instrument", a cockpit read
left-to-right along the pipeline with the posture plane and a fleet ladder); **Ledger won** and the
Instrument variant, the pre-redesign baseline, and the A/B switcher were deleted.

`OverviewLedger` (`src/features/standing/overview/OverviewLedger.tsx`) composes the region; the
dimension section is `LedgerDimensionRows`, fed by the pure `buildDimensionReadings` in
`dimensionReading.ts`:

- **Grouped by SDLC phase.** `SDLC_PHASES` — *Author with AI* (D1 AI Tooling · D4 Agentic · D8 AI
  Process), *Verify* (D2 Testing · D6 Quality · D9 Security), *Ship & learn* (D3 CI/CD · D7 Commits
  · D5 Docs). Each phase rule carries the question it answers and its own average, so a weak
  *phase* is visible before any single number is read. This mapping is a product judgement about
  how the rubric lays onto a delivery pipeline, **not** the maturity model's own grouping (that is
  the adoption/rigor axis on each `DimensionDef`, which drives posture); it is the first thing to
  argue about if the ledger is revised.
- **One line item per dimension**, in fixed columns: name + **status word** (band word from
  `levelForScore`: Weak · Emerging · Developing · Solid · Strong) · meter · score · window delta ·
  a **one-line reading** (`weakest of 9 · below green in 3 of 3 repos · ▼4 vs 30d ago`; "below
  green" is `< FOLLOW_UP_BELOW`, counted over the heatmap rows) · **`Practice → <name>`** (the
  practice card that lifts the dimension, named so the click is legible) · **`▦ <n> repos`** (this
  page's heatmap, sorted weakest-first on the dimension). Every column is a fixed `rem` track
  except the meter and the reading, so the columns align across rows regardless of label length
  (each row is its own grid; `auto`/`minmax` tracks would resolve per row).
- **Posture composition** is unchanged (`PostureCompositionBar`, hoisted from the deleted panel):
  one stacked bar of true shares, each segment and legend chip a link to Repositories filtered to
  that posture.

### Segments (a Repositories tab, not a standalone page)

Segments used to be a standalone `/org/[slug]/segments` route with its own rail item; that
route file still exists (`src/app/org/[slug]/segments/page.tsx`) but only as a permanent
redirect to `/org/[slug]/repositories?tab=segments`, so old links/bookmarks don't 404. The
real view is now the `?tab=segments` view of `org/[slug]/repositories/page.tsx`
(`src/app/org/[slug]/repositories/page.tsx`), rendered by `SegmentsSection`
(`src/features/standing/repositories/SegmentsSection.tsx`) under the shared `FleetTabs`. The
repositories page branches to it *before* running the repo-inventory/rollup reads, so the
Segments view doesn't pay for a rollup it won't render. It shows user-defined fleet slices
(platform, mobile, legacy…), top to bottom:

1. **Create & tag** (`RepoSegmentsPanel`) — the segment manager: create/rename/recolor/delete a
   segment, auto-add every repo of a language, and tag repos one by one. It renders at **any**
   segment count, including zero.
2. **Segment maturity** — per-segment rollup cards, once there is at least one segment.
3. **Compare** — side-by-side segment-vs-segment (headline metrics + per-dimension Δ).

The manager moved here from the main Repositories view on 2026-08-19. It used to sit above the
leaderboard, which left this view with an empty state whose only advice was "go to the Repositories
tab and create one" — a dead end on the exact screen a user opens to work on segments. It now feeds
off `listTaggableRepos` (`src/lib/db/segments.ts`), a three-column read over the same
watched-OR-has-scans universe `getOrgRollup` uses, so hosting it here does **not** reintroduce the
rollup this view deliberately skips.

**Two different `repoCount`s, by design: label whichever one you render.** `listSegments`'s
`SegmentRow.repoCount` counts every repo ever **tagged** into the segment, watched or not,
scanned or not (the number `RepoSegmentsPanel`'s tagging chips show). `SegmentSummary.repoCount`
(from `listSegmentSummaries` / `compareSegments`, used by the Segments tab's rollup cards and
comparison view) counts only the segment's repos in the **fleet-rollup universe** (watched OR
has-scans), the same restriction `getOrgRollup` already applies everywhere else. A segment with
tagged-but-unwatched/unscanned repos legitimately shows a smaller number on its rollup card than on
its tagging chip; that is "tagged" vs "scored," not a bug, and both surfaces carry a tooltip saying
which one they are. Since 2026-08-19 the two counts sit **on one screen** (chips above, cards
below), so the labelling matters more, not less.

### Context half-life (the Repositories tab's context-layer lens, W4, real)

`ContextHealthPanel` (`src/features/standing/repositories/context-health/`) renders **below** the
leaderboard: the quality-over-presence read of the fleet's agent-context layer (CLAUDE.md /
AGENTS.md / rules files). It went **real** in W4: the P4 prototype's Baseline/Half-life switcher
and its `contextHealthMock` synthesis are deleted; every number now comes from the
`contextHealthJson` each scan persists (derivation:
[scan.md → Context Health](../scanning/scan.md#context-health-srclibanalyzecontext-healthts--w4)).

- **Data path**: `getOrgRollup` parses `Repository.contextHealthJson` onto `OrgRepoRow.contextHealth`
  (defensive parse; malformed → null); `contextHealthModel.ts` builds the rows and the fleet summary
  purely, reusing the shared decay math (`decayPotency`/`halfLife`/`guidanceTolerance` from
  `src/lib/analyze/context-health.ts`) so scan-time potency and the panel's projection can't drift.
- **Fleet tiles**: context **coverage %** (repos with guidance / assessed repos), median projected
  **half-life** at current commit rates, **past half-life** count (potency < 50), and **dead
  references** (guidance pointing at deleted files). The band bar splits classifiable repos into
  fresh / aging / stale / absent; repos are listed most-urgent first (decayed before missing,
  since a wrong map misleads an agent further than no map).
- **Honesty rules**: staleness figures are always **≈** (weekly-bucket derived, `windowCapped`
  lower bounds labeled with a `+`); a degraded freshness lookup renders potency **"?" (unknown)**,
  never a fabricated band; and a repo whose latest scan **predates W4** renders as
  *"Not assessed by this scan — re-scan to measure context health"*, never as absent context.

### Guidance coherence (the second card on Context Health, #15, 2026-08-30)

Half-life asks *"when did this guidance stop being true?"*. Coherence asks the orthogonal question:
**"is it true in more than one place at once?"** A repo that adopted agents from several vendors
usually carries several instruction documents — `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
`.github/copilot-instructions.md`, `.windsurfrules` — addressing the same audience about the same
codebase, with nothing reading them against each other. Once they drift, the answer an agent gets
depends on *which file it opened*. Every vendor scorer favours its own format; only a vendor with no
agent to upsell can credibly nominate which one is the authority.

`GuidanceCoherenceCard` renders below the half-life panel, from the same `getOrgRollup` fetch.

- **Data path**: the scan builds a `GuidanceGraph` (`src/lib/analyze/guidance-graph.ts`) — every
  guidance document parsed into commands, rules and pointers, plus a nominated canonical source, the
  contradictions between them, and a `coherence` number whose every deduction is itemized with the
  paths it was read from. It persists as `Scan.guidanceGraphJson`, caches on
  `Repository.guidanceGraphJson`, and `getOrgRollup` parses it back onto `OrgRepoRow.guidanceGraph`.
  `guidanceCoherenceModel.ts` builds the rows and the fleet summary purely.
- **Per repo**: the coherence number, the canonical file with the **basis** it was nominated on
  (declared in the manifest · every other file points at it · named by a generated-from header · the
  only document), a chip per vendor format (canonical / in-sync / stale / independent / unsampled),
  every penalty with both of its paths, and each contradiction as two quoted lines.
- **Fleet count**: *"N of M assessed repositories have contradicting agent guidance"* — the headline
  states its own denominator, because a count of repos out of an unstated population is the shape of
  claim that gets quoted back without its caveat.
- **Honesty rules**: a repo whose latest scan predates rubric **r11**, or that carries no guidance
  document at all, has `coherence: null` — it renders **"—"**, never a zero bar, and is excluded from
  the denominator and from the mean. A guidance file the fetch budget never reached contributes
  presence only and can never create a penalty.
- **Not an alarm.** A contradiction is evidence. It withholds D1 points (see
  [maturity-model.md → D1](../scanning/maturity-model.md)), and it never fires an alert, never fails
  a gate, and never subtracts from a score.

Acting on it is the `consolidate-guidance` practice
([practices.md](practices.md)) and, in the repo itself, the manifest `guidance` block plus
`node .ai/maintain.mjs project` / the doctor's projection-drift check
([ai-manifest-spec.md](../onboarding/ai-manifest-spec.md)).

### Passports → Capabilities: declared vs proven vs wired (#13, 2026-08-29)

The third Passports switcher view (`CapabilityMatrix.tsx` over the pure `capabilityAgg.ts`) answers a
question no vendor scorecard can: **which repositories have PROVEN the things they themselves claim
they can do.** Every other maturity view scores a repo against Ascent's criteria; this one scores it
against the contract the repo wrote — its `.ai/manifest.yaml` — and shows which of those declarations
its own `doctor.mjs` has actually run and passed.

Where the data comes from: the scan reads the manifest into a `ManifestReadout`
(`src/lib/standard/readout.ts`), persists it as `Scan.manifestJson` with the latest cached on
`Repository.manifestJson`, and `getOrgRollup` parses it back onto `OrgRepoRow.manifest`. It is
display-only — it feeds no score beyond the two long-standing D1 manifest awards, and never the LLM
prompt (the same discipline Context Health follows).

The matrix is repo × capability, with four cell states and each declaration's control placement:

| Cell | Means |
| --- | --- |
| **verified** | the repo's own doctor ran this command and it passed |
| **declared** | declared in the manifest; not run, or its last run **failed** (the cell marks the failure) |
| **placeholder** | declared but still a `<placeholder>` — not fillable yet |
| **absent** | this repo does not declare this capability at all |

A solid underline means the capability is enforced **pre-push**; a dotted one, as a **CI hard pass**.
A repo's row also names any control it declares with no backing capability.

**Unassessed repositories are separated, never folded in.** A repo whose latest scan read no manifest
(or whose blob was unparseable) is listed in a dashed *"not assessed — re-scan"* band **below** the
table and is excluded from every count and ratio above it. The fleet ratio is rendered as `—`, not
`0%`, when nothing was assessed. Rendering an unread repo as `0/0` would make "we have not looked"
and "this repo declares nothing" the same number, which is precisely the honest-null rule the rest of
the dashboard is built on.

Capability commands are repo content, so they are redacted at read time (any token- or
`secret=`-shaped run becomes `«redacted»`), shown only inside the owning org, and never placed on a
public or cross-tenant surface.

### Passports → Doctor checks: the fleet matrix from the repos' own CI (#16, 2026-08-29; renamed from "Controls" 2026-08-31, MC-B10)

The fourth Passports switcher view, and a deliberate **sibling** of Capabilities rather than a merge
with it. Capabilities is what a repo *declares* (read from its manifest at scan time); Controls is
what the repo's own `.ai/doctor.mjs` *judged* in the repo's own pipeline and reported back. Same
subject, two independent sources of evidence — folding them together would hide which is which.

Where the data comes from: a doctor run POSTs `findings[]` (spec 0.3.0) to
`/api/report/conformance`; `recordConformance` writes the `Repository.aiConformance*` columns, the
`ConformanceReport` + `ConformanceFinding` rows and the signed `conformance.reported` audit entry in
**one transaction**. `ControlMatrixPanel` reads
`GET /api/report/conformance/matrix?org=<slug>` (org-slug gated with `requireOrgRead` before any
query runs). Columns are check *families*, collapsed by default and expandable to the individual
clause (`control.prepush.test`).

Four cell states, and the fourth is why the surface is trustworthy:

| Cell | Means |
| --- | --- |
| accent hairline | the clause passed in that repo's own run |
| amber | it warned |
| rose | it failed |
| **dashed "—"** | **this run did not judge the clause** — or the repo never reported it at all |

A repo whose doctor sent only summary numbers is stamped **summary-only (doctor < 0.3.0)** and every
one of its cells reads "not judged". An absent finding is never rendered as a passing control, and a
failed request surfaces as an error rather than as an empty grid: an unanswered query is not evidence
that a fleet has no controls.

`since` is `null` — rendered "—" — whenever the visible window (the last ≤20 reports per repo) holds
no level change. Printing the oldest report we happen to retain would present the edge of retention
as a fact about the repo.

Two properties worth stating because they are easy to assume wrongly: the ledger rows are **derived
data and carry no signature** (the tamper-evident copy is the signed `conformance.reported` audit
entry), and `detectControlRegressions` — exported from `src/lib/standard/control-matrix.ts` — fires
only on `pass`/`warn` → `fail`. `unchecked → fail` is not a regression: an environment that just
started judging a clause has not broken anything.

The GET trend on `/api/report/conformance` reads these rows too. It used to be reconstructed by
walking up to 1,000 audit rows per request; `loadConformanceTrend` is gone, and `points` keeps its
exact shape so no client moved with the storage.

### Tech Stacks — dimension analysis, and what each verdict rests on

The Tech Stacks tab's "Consensus & transfer plan" board diagnoses every dimension across the
org's scored stacks (`computeFleetInsights`, `src/features/standing/tech-stacks/fleetAnalysis.ts`)
and labels it **divergent** (best-vs-worst ≥ 35 pts), **gap** (even the best stack ≤ 45),
**strength** (even the worst ≥ 68) or **consistent**. Divergent and gap rows expand into a
transformation playbook (moves, a proposed Practices artifact, an adoption checklist). How to read
the board lives behind the **?** disclosure beside its title (`SectionHelp`, a native `<details>`,
so the server panel stays a server panel), not as a paragraph under it — the board is scanned far
more often than it is explained.

**The A-vs-B "Compare stacks" panel was deleted (2026-08-19)**, root and branch:
`TechStacksComparePanel` / `StackComparePanel` / `TechStackComparePicker`, the `insightCompareHref`
deep link (`#compare`) into it, and its data read — `compareTechStacks` + `summarizeTechStack`
(`src/lib/db/tech-groups.ts`) and `tech-groups-compare.test.ts`. It answered a strictly narrower
version of what this board already answers: which stack leads, which lags, by how much, on which
dimension — for two hand-picked stacks instead of all of them, with no playbook attached.
`listTechStackSummaries` is now the tab's only per-stack read. Segments keep their A/B comparison
(`compareSegments`); only the tech-stack one is gone.

**Every verdict states its coverage (2026-07-29).** A dimension is only averaged over the stacks
whose scans actually carry it, so a "divergent" call can rest on 2 of 8 scored stacks or on all 8.
Each `DimInsight` carries `count` (contributing stacks) and `scoredCount` (the denominator), and
both the diagnosis row and the expanded playbook render an `n/N stacks` chip beside the verdict.
`coverageOf` grades that ratio: **full** (unanimous), **partial**, or **low** (< 60% of the scored
stacks). A low-coverage row is **de-weighted, never hidden or reclassified**: its class pill and
spread bar drop to neutral ink instead of the class colour, the chip says "low coverage" in words
(not colour alone), and the playbook adds a plain-language caveat naming the numbers. The
classification thresholds themselves are untouched by coverage; the verdict still shows, its
confidence is just legible. (Previously `count` was computed and then discarded before render, so
a two-stack pattern and a fleet-wide one looked identical.)

### Security — the band spectrum as ledger footing, and findings as a table (2026-08-19)

The tab carries **no standfirst under its title**. The three sentences that used to sit there (what
the score is evidenced from, how it is computed, that a score is clickable) restated the Control
matrix caption a screenful above the thing they described. The caption itself now renders as a plain
full-width `<p>` beneath `SectionHeader`, *not* through its `description` slot: that slot is a lede
capped at `max-w-2xl`, which wrapped a dense data caption into four short lines against a card three
times as wide. Passing a competing `max-width` through `descriptionClassName` would be a cascade
coin-flip — two utilities of equal specificity, resolved by Tailwind's emission order rather than by
the class list — so the caption owns its own element. Reach for the same pattern elsewhere before
reaching for an override.

**`SecurityBandSpectrum` is now a cell of the summary-tile ledger, not a section.** It renders
`col-span-full` as the ledger's last child, so `TILE_GRID`'s `gap-px` hairline bed lays the thin
coloured bar flush under the four tiles, in place of the frame's plain bottom border. It must stay a
DIRECT child of the `TILE_GRID` element (the hairline bed only reaches direct children) and it paints
`bg-ink` like every other cell. At `scanned === 0` it renders nothing and the ledger closes with its
own border. The legend stays: the bar alone would be a colour-only signal.

**Findings to decide is a table (`SecurityFindingsTable`), not a list.** One finding is one failing
control on one repo, so the set is `repos × failing checks` — a 40-repo fleet with six weak controls
each produced 240 stacked cards, tens of screens deep, with no way to reach a specific repo. The
server half (`SecurityFindings`) does the decision join and the ordering (open → snoozed → accepted →
dismissed, then repo, then control) and hands plain rows over; the client half owns filters, the row
cap and the expand state. It is modelled on the Follow-ups worklist on purpose — same problem, and
two "here is every open item, decide about it" screens should not read as two products:

| Borrowed from `FollowupsWorklist` | Why |
| --- | --- |
| `OrgTable` | one scroll wrapper, hairline chrome, `minWidth` so a wide table scrolls instead of crushing columns |
| `FilterMenu` + search + "N of M · clear filters" | options built from the FULL row set, so a menu never shrinks as you filter |
| expand-in-place second `<tr>` | the row is the summary; the risk prose stays out of the default view |
| **not** bulk selection | a decision carries a rationale that reaches Shared Org Memory and the next scan's prompt, so "dismiss 40" would mean 40 findings sharing one reason |

Rows render `PAGE = 25` at a time behind a "show N more · M remaining" button, and any filter change
resets the window. `Finding.subject` (added for this) carries the control's own name without the
`(repo)` suffix `title` carries, so a table with a repo column doesn't print the repo twice per row —
`title` is still what gets persisted onto the `OrgDecision`, and `itemKey` is still the only identity.

### "Who to enable next" belongs to Contributors, not Adoption (2026-08-19)

`EnablementTargets` — the zero-AI contributors carrying the most recent volume — moved from
`src/features/standing/adoption/` to `src/features/bought/contributors/`, and now renders directly
under `IndividualInvolvement`. It is a **named per-person roster**, which is the one thing the
Contributors tab is for and the thing Adoption otherwise keeps at arm's length (rates, bands, teams).
The two per-person lists now read as one section: who is leaning in, and who hasn't started.

- **The cohort is defined once.** `enablementTargets(insights)` (`src/lib/org/adoption.ts`) is the
  single definition, applying `ENABLEMENT_MIN_COMMITS` (3), `ENABLEMENT_LIMIT` (8) and the
  `namingAllowed` / `CHAMPION_MIN_POP` privacy guard. `buildAdoptionOverview` still calls it, because
  the adoption LLM brief keeps its enablement ASK; `ContributorsInsightsPanel` calls it off the
  `getContributorInsights` result it already holds, so hosting the table costs **no extra read** and
  the two surfaces cannot disagree about who is on the list. Re-deriving the thresholds at a second
  call site is exactly what let three adoption surfaces drift apart before.
- **An empty list is the render guard**, at both call sites. Below the naming floor the helper returns
  `[]`, so nothing renders and no caller re-checks the population.
- **The Adoption spread bar still points at it**, now as a cross-tab deep link
  (`?tab=contributors#enablement`); `AdoptionSpectrum.showEnablementLink` degrades the same sentence to
  plain text when the cohort is empty, so it never links to a section that isn't there. The `<details>`
  carries `scroll-mt-24` so the arriving anchor clears the sticky header.

### Governance: no standfirst, no "Cheapest path to green" (2026-08-19)

Both deleted, root and branch. The standfirst restated what the policy card, the fail-reasons card and
the CI card each say at the point of use, a screen above any of them. `GovernanceClosestToGreenCard`
re-listed the same failing repos as `GovernanceFailingReposCard` directly above it, re-sorted by
closeness.

**The closeness math went with it.** `GovernanceOverview.closestToGreen`, the `GreenPathItem` /
`GreenPathDim` types and the whole per-repo `greenPath` walk (points to each dimension floor, the
practice that clears it, the non-numeric blockers — PRAC-6) are gone from
`src/lib/org/governance.ts`, along with its now-unneeded `effectiveFloor` / `DIMENSION_BY_ID` /
`PRACTICES` / `DimensionId` imports and the test assertions that covered them. `governanceMarkdown`
never consumed the field — its "cheapest path" ASK is prose the model answers from the failing-repo
list it is handed — so the brief is byte-identical. `buildGovernanceOverview` now does strictly less
work per governance read.

That card was also the flagship governance→practice handoff, so the `#practice-<id>` deep link now has
**four** emitting surfaces, not five (see `usePracticeHash`, `PracticeLedger`): the executive briefing,
plan initiatives, and the overview's fix-first list + posture dimensions. The receiving contract is
unchanged.

### "Where the fleet fails": a structural zero is not a measurement (2026-08-31)

The fail-reasons card renders one row per `GateFailure` code. Two of them — `control` (#16, a required
doctor check reported failing) and `admission` (#8, AI authorship in a blocked repo) — **cannot be
judged on the fleet path at all**: `evaluateGateLite` scores from the rollup's persisted numbers, and a
rollup row carries neither a conformance ledger nor PR stats, so both criteria are skipped on every
repo, every time. `governance.ts` has always said so in a comment — *"these stay 0 honestly, because
the criteria were never DUE here"* — and the comment never reached the screen.

Live cost (UAT 2026-08-30, `PRIYA-L1-02`): a platform lead who had just declared two required controls
read **"A required control is failing — 0 repos"** beside five genuinely measured meter rows, while the
per-repo CI gate was blocking PRs on exactly those controls. Those two rows now render
**"not judged fleet-wide — the per-repo gate decides it"** with an em-dash in the count column instead
of a 0-meter, and the card's all-clear empty state carries the same caveat when the org's stored bar
actually declares one of them (`unjudgedBarsDeclared`). The set lives in
`governanceReasons.ts` (`FLEET_UNJUDGED_REASONS`); `governance` and `provenance` are deliberately NOT
in it — the rollup carries the branch-protection fields and `aiGovernedRate` / `aiPrSample`, and
`evaluateGateLite` evaluates both, so their zeros are earned.

### Delivery's "Required status checks" tile (2026-08-31)

Renamed from **"Require checks"** (UAT `PRIYA-L1-07`). It is `OrgGovernance.requireChecksRate` — the
share of repos whose default branch requires status checks under branch protection — and it was one
phrase away from `GatePolicy.requireChecks` on the Governance tab, which is an entirely different
thing (doctor control ids that must not be reported failing). Two tabs, one word, two meanings, on a
dashboard a lead cites to an auditor. The tile now reads "Required status checks" with a
`branch protection` subtitle.

## Dashboard rollups (`src/lib/db/org.ts`)

`src/lib/db/org.ts` is a ~114-line **barrel**: a thin re-export surface, not where the
queries live. The implementation is split across themed `src/lib/db/org-*.ts` sub-modules,
each guarded by `DATABASE_URL` at its call sites, so `@/lib/db/org` (and the `@/lib/db`
barrel) keep an unchanged public surface for callers:

| Sub-module | Re-exports |
| --- | --- |
| `src/lib/db/org-watch.ts` | Watchlist + scan scheduling: `isRepoWatched`, `setRepoWatch`, `setRepoSchedule`, `setWatchedSchedule`, `seedWatchlist`, `listDueRescans`, `advanceScheduleAfterFailure`, `advanceToFullCadence`, `claimRescan`, `claimRepoScan`, `releaseRepoScan`, `recordScanOutcome`, `recordConformance`, `listWatchedRepos`, `listOrgsWithWatchedRepos`, `reconcileListedRepos`, `listMissingRepos`. |
| `src/lib/db/org-rollup.ts` | `getOrgId`, `getRepoStates`, `getOrgRollup`, `getOrgRepoHistories`, `getOrgHeaderSummary`, `getOrgEngineMix`, `getOrgRecsActioned`. |
| `src/lib/db/org-alerts.ts` | `getOrgAlertWebhook`, `setOrgAlertWebhook`, `getOrgAlertThresholds`, `setOrgAlertThresholds`. |
| `src/lib/db/org-gate.ts` | `getOrgGatePolicy`, `setOrgGatePolicy`. |
| `src/lib/db/org-contributors.ts` | `getContributorInsights`. |
| `src/lib/db/org-signals.ts` | `getOrgPrSignals`, `getOrgGovernance`, `getOrgDimensionGaps`, `getOrgActivity`. The commit-activity week grid bins in the **canonical org zone** (same zone the window snaps in), flooring to Sunday *before* indexing — the epoch 7-day grid is Thursday-anchored. GitHub's `commit_activity` buckets are Sunday-**UTC**-aligned, so each provider bucket is placed on the zoned grid by its midpoint (the zoned week it mostly covers); converting the grid without converting through the source bucket is an off-by-one week on every bar. |
| `src/lib/db/org-insights.ts` | `getOrgMovers`, `getOrgRecommendations`, `getOrgBacklog`, `dueBucketFor`, `getOrgBenchmark`, `getOrgPractices`, `getOrgGapAnalysis`, `getOrgDiscrepancies`. |
| `src/lib/db/org-teams.ts` | `getOrgTeamRollup`, `rollupTeams`. |
| `src/lib/db/org-nav-counts.ts` | `getOrgNavCounts`, `getOrgPassportBlockers`. |

### Shell cost discipline: nobody buys a rollup to read a scalar (2026-08-03)

`getOrgRollup` is the dashboard's heaviest read: every repo's latest scan **with its dimension
rows**, plus governance / passport / tech-stack JSON parsing, plus two unbounded `scan.findMany`
sweeps (the daily trend and the baseline cohort). Its cost scales with fleet **history**, not with
what the caller renders. Three surfaces were paying it to read a handful of scalars; all three are
now on narrow queries.

| Surface | Was | Now |
| --- | --- | --- |
| Overview `generateMetadata` (unfurl copy) | full unscoped `getOrgRollup` | `getOrgHeaderSummary` (fixed earlier) |
| `passports` nav badge (`deriveFindings`, org **shell** → every tab) | full unscoped `getOrgRollup`, read `repos[].passport.*.blockers` | `getOrgPassportBlockers` |
| `opengraph-image.tsx` (per crawler fetch) | full unscoped `getOrgRollup`, read 5 scalars | `getOrgHeaderSummary` |

- **`getOrgPassportBlockers(slug)`** (`src/lib/db/org-nav-counts.ts`): the passport blob lives on
  `Repository`, not on `Scan`, so the badge needs no scan join at all: three columns over the same
  repo set the rollup uses (`watched OR has-scans`), same `applyPassportOverrides` composition, both
  readiness axes. The badge number is unchanged. This one matters most because the derivation runs in
  the **shell**, so the old cost was charged to tabs that read nothing else from the fleet (Audit).
- **`getOrgHeaderSummary` gained `avgAdoption`, `avgRigor`, `postureCounts`** rather than a second
  parallel summary query being forked for the OG card. They come off the same latest-scan-per-repo
  pass the summary already runs (three more columns on an existing `select`, no extra round-trip),
  and each derivation mirrors `getOrgRollup`'s exactly, so the two can never disagree.

Neither change alters a single rendered value. Measured on the seeded local fleet (`acme`: 20 repos /
120 scans / 180 dimension rows) the unscoped rollup ran a median **16.9 ms**; the passport read is
**2.0 ms** (8.5×) and the header summary **5.3 ms** (3.2×). The gap widens with scan history, since
the rollup's two unbounded sweeps grow with it and neither replacement touches `Scan` history at all.

Regression-pinned by `src/lib/db/org-passport-blockers.test.ts` (the query must stay scan-free and
keep the rollup's repo set) and `src/lib/org/nav-counts.test.ts` (`getOrgRollup` is never called from
the badge path).

The Overview page composes several server queries, all scoped to the org:

| Function | Produces |
| --- | --- |
| `getOrgRollup(slug, window?, segmentId?)` | Latest scan per repo → fleet averages, posture distribution, dimension averages, daily trend, and a linear `Forecast`. With a `window` it also returns a `baseline` snapshot (latest scan per repo as of `window.start`) and per-metric `deltas` for period-over-period tile comparisons; the trend is bounded to the window. An optional `segmentId` scopes every figure to a [segment](#segments)'s tagged repos. |
| `getOrgMovers(slug, window?, segmentId?)` | Per-repo delta over the window: latest scan vs the baseline scan strictly before `window.start` (gainers / regressions / held / levelChanges). Without a window, falls back to the two most recent scans ("since last scan"). Optional `segmentId` scopes to a segment. A repo with no scan before `window.start` (onboarded mid-period) is a **lifetime** delta, not a period one: it's tagged `baselineKind: "onboarded"` and reported separately in `onboarded`, excluded from `gainers`/`regressers`/`held`/`levelChanges`/`comparedRepos` so a fleet's onboarding wave can't read as that period's improvement. |
| `getOrgRecommendations(slug, limit, segmentId?)` | Open recs aggregated across latest scans, ranked by leverage `repoCount × impactWeight × (1 + dimWeight)`. Optional `segmentId` scopes to a segment. |
| `getOrgBacklog(slug, segmentId?, now?, techGroupId?, opts?)` | The recommendation **backlog**: actionable per-repo recs (open + in_progress) from the latest scans (carrying owner + due date), grouped by owner and by due-date bucket (overdue / this week / this month / later / no date), with overdue/due-soon/unassigned counts and the fleet's contributor logins for the assignee picker. Pure `dueBucketFor(date, now)` (unit-tested) does the bucketing. Backs the Follow-ups ledger (the Backlog tab it originally served retired 2026-08-17; owner/due-date fields are carried but no longer surfaced); mutations go through `updateRecommendation` (`src/lib/db/scans.ts`), which records a `RecommendationEvent` per change. **Reversibility (2026-07-28, G6-02):** `opts.includeClosed` groups the done/dismissed rows too (`GET /api/org/backlog?includeClosed=1`, surfaced as the panel's "Show done & dismissed" toggle) so an item closed by a mis-click stays findable and can be set back to Open: the ACTIVE-only default was previously a one-way door. Every headline count still describes the ACTIVE backlog either way, and a closed row never reports `overdue`, so the toggle moves no number. |
| `getOrgBenchmark(slug)` | The org's average-overall percentile vs every other org's **public** repos (the corpus). **Tenancy (2026-07-28):** the cross-tenant corpus query is filtered to `isPrivate: false`: other tenants' private repo scores must never feed a percentile handed back to a different org. This org's own side is unfiltered (an org is entitled to its own private repos). **Corpus eligibility (2026-07-28):** both sides of the comparison are filtered to non-`mock` engines at the *current* `SCORING_RUBRIC_VERSION`: a percentile is a claim that two numbers came out of the same instrument, and demo/keyless `mock` scans plus retired-rubric rows were previously ranked as peers. `corpusBasis` is returned with every result so a percentile always travels with the population it was computed on. |
| `getOrgGapAnalysis(slug, segmentId?)` | Common org gaps (weak in ≥ 50% of repos) vs repo-specific outliers, each linked to a [practice](./practices.md). Optional `segmentId` scopes to a segment. **This is a SCORE-level read** — which dimensions are weak, and where. The per-repo **signal-level** counterpart is the exemplar diff on `/report/compare?against=` ([report.md](../reporting/report.md#exemplar-axis-srclibreportexemplarts--exemplarpanel)): which concrete evidence strings a stronger repo carries that this one lacks, joined to the same `PRACTICES`-by-dimension map this table links to. Fleet gap analysis says *which dimension*; the exemplar diff says *which signal, and whose*. |
| `getOrgPractices(slug)` | Per-dimension exemplars (score ≥ 70) and gap repos (< 40) for the Practice Library. |
| `getContributorInsights(slug, segmentId?)` | Champions, involvement, concentration/bus-factor, plus the aggregate AI-share `distribution`. Optional `segmentId` scopes to a segment. **Privacy floor (2026-07-28):** below `CHAMPION_MIN_POP` (3) humans it returns `namingAllowed: false` and emits NO per-individual data at all: `champions: []`, `contributors: []`, and `concentration[].topLogin` redacted to `—`; every aggregate (totals, shares, distribution, bus factor) is unaffected. The floor lives in the producer, not in the pages, so the CSV export, the adoption brief and any future consumer inherit it. |
| `compareSegments(slug, aId, bId?)` (`src/lib/db/segments.ts`) | Two segments side by side (B may be null = whole fleet): headline metric deltas + per-dimension Δ. Reuses `getOrgRollup`'s scoped averages; the pure diff is `buildSegmentComparison` (unit-tested). `listSegments` / `createSegment` / `setRepoSegment` / `getRepoSegmentMap` manage the `Segment` / `RepoSegment` tags. |
| `getOrgTeamRollup(slug)` | Per-team rollup keyed by CODEOWNERS attribution (`RepoTeam`, captured at scan time): each team's Adoption×Rigor, per-dimension averages (strongest/weakest), merged human AI-commit knowledge + champions, and since-last-scan movers, across the repos it owns. Team `champions` are subject to the same producer-level `CHAMPION_MIN_POP` floor (empty below 3 team contributors), and the knowledge leader is elected only from teams that clear it. Plus the org's AI-knowledge leader and the single highest-leverage strong→weak cross-team pairing. Pure aggregation lives in `rollupTeams` (unit-tested). |
| `getOrgGovernance` / `getOrgActivity` / `getOrgPrSignals(slug)` | Delivery-tab aggregates (point-in-time: each repo's latest scan). |
| `getOrgDeliveryTrend(slug, window, segmentId?, techGroupId?)` (`src/lib/db/org-delivery-trend.ts`) | **Delivery over time (2026-07-28).** The Delivery tab's only *windowed* read: it walks every `Scan` in the period and folds the already-persisted `prStats`/`governance` blobs into one point per canonical-zone calendar day. Rates are analyzed-PR-weighted exactly like `getOrgPrSignals`; a nullable rate stays null ("no sample" ≠ a measured 0); unreadable governance contributes nothing. Each point carries its own `scans`/`repos`/`prs` sample size, because a point describes **the repos scanned that day, not the fleet**, the same semantics as the maturity trend, disclosed rather than reconstructed. Lower bound is retention-clamped like the maturity trend. `fits` gives a per-week slope for `reviewedRate` / `aiGovernedRate` / `hoursToFirstReview` (the last in hours/week, the W1a review-latency delta), gated by the **shared** `forecastInsufficiency` floor and deliberately narrowed to the slope fields (a review-coverage percentage has no maturity level, so `projectedLevel`/`eta` are never exposed). Pure `buildDeliveryTrend` / `buildDeliveryRateFit` are unit-tested. |
| `computeOrgResilience(concentration)` (`src/lib/db/org-contributors.ts`) | **Org resilience / key-person exposure (2026-07-28).** Returned as `ContributorInsights.resilience`. Rolls the per-repo concentration rows into a commit-weighted fleet score (0-100), a critical/at-risk repo count, `exposedCommitShare` (how much of the fleet's recent commit volume sits in at-risk repos), and the riskiest repos ranked by `0.6 × topShare + 0.4 × (100 / busFactor)`. **It emits no login at any population size**, stricter than the `CHAMPION_MIN_POP` floor, on purpose: a "risk" framing is where a name stops being attribution and becomes an accusation, and the repo-level statement ("one point of failure, 92% concentration") carries the whole decision. Conversely it *survives* below the naming floor: a 2-person org is the most exposed org there is, so withholding the read would hide the finding, not a person. |
| `getOrgDiscrepancies(slug)` | Aggregated LLM-auditor flags grouped by dimension (the calibration backlog). |

**Trajectory** (`src/features/standing/overview/Trajectory.tsx`) renders the `Forecast` from
`src/lib/maturity/forecast.ts`, a linear regression over the daily maturity series:
now → projected score/level at the horizon, weekly rate, direction, ETA (date) to the next
level, and an R² fit-quality confidence. Shared layout primitives (`Tile`, `Card`,
`SectionHeader`, `Meter`, `SectionEmpty`, posture labels) live in
`src/components/org/shared/ui.tsx`.

## Change-management evidence pack (W2, 2026-08-14)

The artifact a SOC 2 Type II examiner actually asks for, assembled from evidence rows ascent already
stores. Downloaded from the **Governance** tab (`EvidencePackCard`), served by
`GET /api/org/conformance-pack`, built by `src/lib/conformance/pack.ts`.

The 2026 auditor position is specific: sufficient evidence for change-management control CC8.1 over
AI-generated code requires **a population of AI-generated changes over the audit period, a sample
drawn from it, and evidence for each sampled item that the control operated.** A percentage is not
evidence, which is why `AiChange` stores rows.

**Four files, one object.** `file` omitted → JSON; `file=manifest` → the markdown cover note;
`file=sample` / `file=findings` → CSV. Each download carries `x-ascent-content-sha256`, and the
manifest additionally embeds both CSV hashes, so the three files verify each other.

### The rules that make it usable as evidence

- **The sample is drawn, never chosen.** Seeded Fisher-Yates (mulberry32 over sha256 of the seed) on
  a stable created-at ordering. The seed is `<org>:<from>:<to>` and is printed in the manifest, so a
  third party reproduces the same rows. The seed depends on org + period **only**, since a
  content-derived seed would silently re-draw an auditor's already-filed sample the moment a late
  scan added one row. A population at or below the sample size is returned whole and says so.
- **Findings come from the full population, never just the sample.** A sample bounds the work the
  *auditor* does; it must not bound what the *vendor* discloses.
- **The population is a LOWER BOUND, stated in the artifact.** Rows exist only for PRs inside a
  repo's scanned window, and unmarked AI assistance is not detected at all.
- **Identities are pseudonymous by default.** Pseudonyms are stable within a pack and unlinkable
  across packs (the seed is folded into the hash). `identities=named` is **owner-gated** and returns
  403 for anyone else, never a silent downgrade, because an examiner who believes they hold named
  evidence and does not would draw a conclusion the artifact cannot support.
- **PR titles are omitted from CSV rows.** Free text routinely carries ticket ids and customer
  names; `repository` + `pr_number` is sufficient to re-verify against GitHub. The column is kept and
  named `title_omitted` so the omission is visible rather than looking like a missing field.
- **Mock-scored repos are disclosed**, with a count, as a limitation, not a footnote.
- **Every export is audited** (`conformance.pack.export`), recording scope, seed and identity mode.

### Claims discipline, non-negotiable

Inherited verbatim from [`AI-SDLC-STANDARDS-LANDSCAPE.md`](../../AI-SDLC-STANDARDS-LANDSCAPE.md) §5
and pinned by tests in `pack.test.ts`:

- Say **"evidence for"** a control, never **"compliance with"** a standard. Compliance and
  certification words may appear only inside a **disclaimer**, and a test enforces that by requiring
  every sentence containing one to also contain a negation.
- Anchor to **SOC 2 CC8.1** first, **ISO/IEC 42001** Annex A second, and say the examiner decides.
- **Never** claim EU AI Act conformity. The pack disclaims it *explicitly* rather than staying
  silent, and states the deferral dates (Annex III 2 Dec 2027, Annex I 2 Aug 2028).

The per-item verdict is deterministic and four-valued: `operated` · `not-operated` ·
`reviewed-not-approved` · `not-applicable`. "Reviewed but not approved" is kept distinct from "nobody
looked" because an examiner will ask which, and conflating them misstates the control environment in
both directions.

Its enforcement counterpart is the [ungoverned-AI-change gate](../scanning/gate.md#the-ungoverned-ai-change-gate-w2-2026-08-14),
which reads the same signal.

### As-of-merge control environment (moonshot #1, 2026-08-30)

Each sampled item and each finding now carries **`environmentAsOf`** — the control settings in force
**at the moment that change merged**, resolved from the control-observation ledger
(`controlsAt`, keyed on `occurredAt`, not on when we noticed).

The defect this closes was an *omission*, not a wrong number. The pack described `environment` as the
repository's control settings without saying they were read at the **latest scan**, which for a
change that merged three months earlier is a different repository from the one being evidenced.

- **The label is per row, not global.** `environmentAsOf.source` is `"ledger"` when the ledger held
  an observation at or before the merge instant, and `"latest-scan"` when it did not and the most
  recent scan's settings were substituted. A global footnote would let a reader treat every row as
  as-of when only some are; the label is a column in both CSVs
  (`environment_as_of_source`, `environment_as_of_observed_at`) so it survives a spreadsheet sort.
- **The fallback speaks the ledger's vocabulary.** It is built with `governanceToSamples` — the same
  mapper every scan- and probe-sourced ledger row comes from — so two rows in one pack are directly
  comparable. An unreadable governance blob falls back to `unmeasurable`, never to `fail`.
- **Coverage is stated with its denominator.** `pack.environmentCoverage`
  (`mergedRows` / `fromLedger` / `fromLatestScan` / `attempted` / `cap`) is published as a structure
  *and* rendered as a "Control-environment coverage" table in the manifest, so the pack's prose and
  its numbers cannot drift. When no row has ledger coverage the pack says so plainly rather than
  omitting the section.
- **The as-of read is capped** at `AS_OF_CAP` (500) merged rows per pack, and the cap is stated as a
  limitation when it bites — rows beyond it fall back for reasons of export size, not of evidence.
- **The export audit row records the evidence grade** (`asOfLedgerRows` / `asOfFallbackRows` /
  `mergedRows`), so "which version did we send them" has an answer after the file is filed.

Rows also carry `evidenceSource` (`scan | webhook`) and `approvalObservedAt` — when a webhook
observed the approval, as distinct from `approvedAt` (the review's own submission time). Null
`approvalObservedAt` means "not observed live", never "not approved".

### Governance control ledger (Governance tab, moonshot #1)

**Named "Governance control ledger" since 2026-08-31** (UAT `NADIA-L1-08` + `PRIYA-L1-07`; it was
"Control observations"). See *Three catalogues, three names* below.

The card sits directly below the evidence pack, because it is the source the pack's as-of
environments are read from. One row per (repository, control): the current state, the last observed
change with its actor, and — always beside the state — the **coverage**: the observation count and
the largest gap between observations. That pairing is the point. "Branch protection held all
quarter" read off two observations three months apart is a sentence the evidence does not support,
so the card never prints a state without its N.

`unmeasurable` renders as an **em dash with a tooltip** — never a zero, never a red — and is counted
separately from "not operating" in the header. A control we could not read is missing evidence, not
a finding; colouring it like one would turn every expired token into a fleet-wide governance failure
on the page a lead screenshots.

#### The catalogue's contracts render (MC-B13, 2026-08-31)

`src/lib/controls/catalog.ts` authored three contracts that were unit-tested and read by **nothing**.
An AppSec lead's L1 pass measured the cost: *"'Published advisories · not operating.' In red. The
catalogue's own sentence for that control is 'No coordinated-disclosure advisory was observed. NOT a
statement that the repo is insecure.' … If I screenshot this table for the CISO, I have just told him
nine repositories failed a security control. They did not."* All three now have consumers, in
`ControlStateCell.tsx`:

- **`failMeans`** — a red "not operating" cell renders the catalogue's own sentence for what that
  control failing does and does not mean, **as text under the state**, not as a tooltip: a screenshot
  crops tooltips and keeps text. Present only on a `fail`; the sentence describes a fail.
- **`descriptor`** — `repo-visibility` is a fact, not a bar. Its state is always `pass`, so the cell
  used to print a green "operating" for a control that cannot operate. A descriptor now renders its
  **value** ("public") in neutral tone with no verdict word at all.
- **`stateTone`** — the tone comes from the catalogue's function; the renderer no longer re-types the
  ternary. `unknown` is deliberately not a colour word (**G15**).

#### One read window, and it says so

The row's state came from the newest 400 observations while its coverage came from the **oldest**
2000 — past 2000 rows the two windows did not overlap, and they were printed on the same table row as
if they described each other. `controlCoverage` now reads newest-first and re-sorts in memory for the
gap arithmetic, so coverage under a state is coverage *of* that state's window; `ControlCoverage.
windowTruncated` says when the cap bit and `coverageSentence` appends *"at least (read window
capped)"* so a floor is never read as a total.

`truncated`/`limit` were computed by the route and the card never called the route, so the surface a
compliance reader actually screenshots carried no completeness disclosure at all. Both now read
`timelineDisclosure` from `src/lib/controls/window.ts`, and a truncated page renders *"This page
stops at the newest 400 observations — it is NOT the org's complete ledger."*

Reads: `GET /api/org/controls?org=&repo=&controlId=&from=&to=&transitionsOnly=1&limit=&format=csv`
(`requireOrgRead`, 503 without a DB), which always returns `coverage` beside `timeline` and flags
`truncated` rather than presenting a capped page as everything. Coverage is deliberately **not**
narrowed by `transitionsOnly`: the heartbeat rows that filter hides are exactly the rows that prove
a control held.

**`?format=csv`** (MC-B14) returns the observation rows with columns in `DIGEST_FIELD_ORDER`,
verbatim and in order — the digest's own field order, so an examiner rebuilds each row's canonical
JSON straight off the header line without reading our source. It is gated identically to the JSON
read, `private, no-store`, and carries the truncation disclosure as `x-ascent-truncated` /
`x-ascent-limit` headers because a file opened in a spreadsheet has no response body to consult.
Before this, `?format=csv` returned `200 application/json` and silently ignored the parameter.

### Three catalogues, three names (MC-B10, 2026-08-31)

Three unrelated control catalogues carried the same word on one dashboard, and a fourth surface had
already taken "SEALED". Two Characters hit the collision from two different tabs. Each now says what
it is made of, and each cross-links the other two:

| Tab | Heading | What it actually is |
| --- | --- | --- |
| Standing › Security | **D9 check battery** | our deterministic Scorecard-style security grading (was "Control matrix") |
| Standing › Passports | **Doctor checks** | per-check findings each repo's own CI reported (was "Controls") |
| Standing › Governance | **Governance control ledger** | branch-protection observations over time (was "Control observations") |

**SEALED belongs to the AI-stance perimeter.** On the Governance tab `Sealed` already meant a
declared no-AI zone, so the control ledger's tamper-evidence says **chained** on screen — "chain
verified through …", "days not yet chained" — and never "sealed". The `SealedZones` copy states the
distinction where the collision was. The **wire contract keeps its own names** (`unsealedDays`,
`sealBacklogRemaining`, `sealDay`, `verifySeals`): an API field is read by an examiner's script, a
heading is read by a human on a tab where the other word is taken.

### Ledger integrity (`GET /api/audit/verify`)

`ControlObservation` rows are sealed **one root per (org, UTC day)** — a hash chain over *days*, not
over rows. A per-row chain was rejected for the reason `audit-integrity.ts` already documents:
webhook deliveries are concurrent, so every append would be a read-modify-write on the previous
row's digest and two writers would fork the chain permanently.

What the seal buys: deleting a row changes its day's root; deleting a whole day breaks the next
day's `prevRoot`; editing a row changes both. Writers never contend, because a day is sealed once,
after it has closed.

- **Sealing is SCHEDULED, closed-day-only** (changed 2026-08-31, MC-B14). It rides the daily
  `/api/cron/rescan` pass (`sealAllPendingDays`, before the GitHub-App check so a DB-only deployment
  still seals), capped at `SEAL_PASS_CAP` = 14 days per pass. It used to be a side effect of
  `/api/audit/verify`, which made an org's tamper-evidence a function of how often somebody curled a
  URL: an org nobody verified accumulated unsealed days until retention aged the rows out, leaving no
  seal behind to show they had existed. **`/api/audit/verify` is now a pure read** — which is what a
  verifier should have been; one that produces its own input is checking its own homework.
- **`sealBacklogRemaining`** is returned by `/api/audit/verify` and by the cron's JSON body: closed
  unsealed days *beyond* what the next pass can take. `unsealedDays` is derived from a **DISTINCT-day
  aggregate** (`$queryRaw` over `date_trunc`, with a row-page fallback that can only under-report),
  not from a capped page of rows — on a busy org the newest 2000 rows can all fall inside two days,
  which hid exactly the older days approaching the retention horizon.
- **It is rendered, and it has a door.** The card's `LedgerIntegrityStrip` prints *"Ledger integrity:
  chain verified through YYYY-MM-DD · N days not yet chained"* with a **Verify now** button and a
  **Download observation rows (CSV)** link — in **both** branches of the card, empty ledger included.
  The only previous reference was a non-interactive `<code>` string naming a URL, inside the non-empty
  branch, so a new org was never told the ledger was verifiable at all.
- **The seal root travels in the filed pack.** The conformance pack carries `ledgerSeal`
  (`throughDay` / `root` / `daysSealed` / `daysVerified` / `chainOk` / `unsealedDays`) and the
  manifest renders a **"Ledger integrity"** section quoting the root. The root is taken from the
  newest *cleanly recomputing* day in the period — quoting one off a day that did not verify would
  prove the opposite of what quoting it implies. With no root the section says so plainly and the
  pack gains a limitation line. The export audit row records `ledgerSealRoot` / `ledgerSealThrough`.
- **A purged day is `no-rows`, not `tampered`.** Both tables age out under the org's `auditDays`
  policy and a purged day **keeps its seal** on purpose: the seal still says "1,204 rows were here on
  2026-05-01" long after the rows are gone, which is what makes a deleted window *detectable*.
  Reporting that as a tamper would cry wolf on every org that retains anything for less than forever.
- **The check is reproducible without our secret.** The response ships `SEAL_RECIPE` — the exact
  canonical field order and the sha256 construction — so an examiner recomputes the roots from an
  export. The stored HMAC is deliberately **not** returned: it proves nothing to someone who cannot
  recompute it, and publishing it hands out a distinguisher against the signing secret.
- **Stated limit, not glossed:** the seals are ours and live in the same database as the rows, so
  they detect alteration by anything *without* database write access. They do not detect an operator
  with database access re-sealing a rewritten day. Independent attestation needs a published key and
  an external timestamp, which ascent does not yet issue.

Both reads are audited (`controls.verify`).

## Canonical time-zone policy (`src/lib/org/timezone.ts`)

Every calendar-day decision the org dashboard makes (window preset starts, custom-range
parsing, trend day-keys, due-date bucketing) resolves in **one** reference frame. Before
this existed each of those picked its own: presets and the custom-range parser used the
**server's local** zone, `daysUntil` compared a UTC-truncated target against a
locally-truncated `now`, and the usage chart keyed days in UTC. The same scan could fall
inside the window on one surface and outside it on another, and a backlog item could read
"Overdue" a day early. (G4-07)

**The policy**

1. There is exactly one canonical zone per deployment, returned by `orgTimeZone()`.
2. It defaults to **UTC**. Server-local was never a decision: it is whatever the host
   happened to be set to (UTC on Vercel, CET on a European dev laptop), so identical data
   produced different day buckets in dev and prod and would move if the host's `TZ` changed.
   UTC is stable, reproducible, matches how date-only columns are already persisted
   (midnight UTC), and matches the day-key axis `src/lib/db/usage.ts` already uses.
3. A deployment may override it with the **`ASCENT_ORG_TZ`** env var (any IANA name, e.g.
   `America/New_York`). An unknown zone degrades to UTC rather than throwing mid-render.
4. **All intervals are half-open**: `[start, endExclusive)`. `ResolvedWindow.endExclusive`
   is the canonical upper bound. The inclusive dialect has exactly **one producer**:
   `inclusiveEnd()` in `src/lib/window.ts`, the edge adapter for call sites whose Prisma
   filter still says `lte`. `ResolvedWindow.end` is that adapter's output and nothing else
   — deprecated, marked at the type level (`InclusiveEndBound`), and gone once the last
   `lte` consumer moves. Never re-derive `endExclusive − 1ms` at a call site: the window
   value carries one closure convention, so two surfaces cannot disagree about a boundary
   row. Hand the db layer `orgWindowBounds(period)` (`src/lib/org/period.ts`) — the
   half-open `{ start, endExclusive }` shape — instead of `{ start, end }`.
   **`OrgWindow` (the shape the db layer queries with) now carries `endExclusive` too**, and
   `upperBound()` (`src/lib/db/org-shared.ts`) turns a window into `lt: endExclusive`, falling
   back to `lte: end` only for callers that have nothing else. Every fleet aggregate
   (`getOrgRollup`, `getOrgMovers`, `getOrgTeamRollup`, `getOrgRepoHistories`,
   `getOrgEngineMix`, `getOrgRecsActioned`, `getOrgDeliveryTrend`) goes through it. This
   matters where two windows **abut**: the executive briefing's prior period ends exactly
   where the current one starts, and under the old inclusive bound a scan landing on that
   boundary instant was counted on *both* sides.
5. A **date literal** (a `yyyy-mm-dd` a human picked, or a date-only DB column such as
   `Recommendation.targetDate`) is *not* an instant. It is read back with
   `dayKeyOfDateColumn` (UTC getters, the frame it was written in) and only then compared
   against `now`'s day in the canonical zone. Never re-truncate a date-only column in a
   westward zone; you get the previous day.
6. Day arithmetic is **calendar** arithmetic (`addDaysInZone`), never `n × 86_400_000`. A
   DST day is 23 or 25 hours, and the old `startOfDay(now − 90 × DAY)` could snap the 90d
   baseline to an adjacent calendar day depending on the render hour.

**Primitives**: `orgTimeZone()`, `resolveOrgTimeZone()`, `knownTimeZone()`, `partsInZone`, `zonedMidnight`, `startOfDayInZone`,
`addDaysInZone`, `startOfQuarterInZone`, `dayKeyInZone`, `dayKeyOfDateColumn`,
`parseDayKey`, `daysBetweenDayKeys`. Pure and isomorphic (no `next/headers`, no I/O), so
`src/lib/window.ts` (which the client `TimeRangeSelector` also imports) can depend on it.

### Which tabs the period actually governs (2026-08-03)

The period is **cross-tab state**: `resolveOrgWindow` layers `?range=` over the `ascent_period`
cookie, so a window chosen on Overview follows the user onto every other tab. Two tabs cannot
honour it, and that is now **disclosed on the tab instead of being silently true**.

| Tab | Period-scoped? |
| --- | --- |
| Overview · Delivery · Briefing · Security · Teams | **Yes**: all resolve `resolveOrgWindow(sp)` and pass the window into their queries. |
| Repositories · Tech Stacks · Passports | **No, by design**: latest-snapshot catalogs. They present no aggregate a range could re-cut. |
| **Adoption · Contributors** | **No, and they say so.** |

**Why they can't be scoped, and why threading a window would be a fake fix.**
`RepoContributor` (`prisma/schema.prisma`) is uniquely keyed `(repoId, login)` and upserted each
scan: it holds *cumulative* `commits` / `aiCommits` totals plus one `lastActiveAt`, with no dated
commit history. `Scan.prStats` is likewise a pre-computed JSON aggregate read off each repo's
**latest** scan (`getOrgPrSignals`). Neither can answer "commits in the last 30 days" at any cost.
Adding a `window` parameter to `getContributorInsights` / `buildAdoptionOverview` would produce a
signature that accepts a range and ignores it, worse than today, because the lie would then be in
the code as well as on screen.

**The contract is disclosure**, but the two tabs now discharge it differently.

On **Contributors**, `SnapshotScopeNotice` (`src/components/org/shared/SnapshotScopeNotice.tsx`)
renders **above the tiles**: it names the range the user has selected, draws it as a visibly **inert**
chip (struck through, `aria-disabled`, the period is acknowledged, never implied to be in force),
states that the figures are a scan-time snapshot, and links to a tab that *does* honour the period.
Pinned by `SnapshotScopeNotice.test.tsx`.

On **Adoption** the banner was removed (2026-08-19) and the disclosure went back into the panel's
closing footnote as one clause — *"Figures are latest-scan snapshots, not a dated window — the period
selector does not apply here."* Weaker placement, deliberately accepted; what is **not** acceptable is
dropping the statement, because the period picker is still in the header and still shows the user's
selection while nothing on the tab honours it. `AdoptionOverviewPanel` no longer calls
`resolveOrgWindow` at all (the notice was its only reader). If that footnote clause is ever edited
away, this row stops being true — remove the period picker in the same change or put the notice back.

**Bucket labels state their maths.** The backlog's due buckets are *rolling* days, not
calendar periods: labels are interpolated from `DUE_SOON_DAYS` (7) and `DUE_MONTH_DAYS` (31)
in `src/components/org/shared/backlogShared.ts`, so "Due within 31 days" can never drift
from the cutoff that produced it. The `this_month` enum key is historical: it has never
meant a calendar month.

**Per-org zones (policy note 6).** `Organization.timezone` holds one org's IANA zone ("this
org's Monday"). Resolution order is **column → `ASCENT_ORG_TZ` → UTC**, owned by
`resolveOrgTimeZone(stored)`; never read the column at a call site, or the validation and the
fallback order drift per surface, the exact defect class this policy exists to prevent. The
storage accessors are `getOrgTimeZone(slug)` / `getOrgTimeZoneSetting(slug)` /
`setOrgTimeZone(slug, tz)` in `src/lib/db/org-settings.ts` (`getOrgTimeZoneSetting` returns the
raw column, so a settings UI can distinguish "inherited" from "explicitly UTC"). An invalid zone
is rejected on **write**; an unknown one already stored still degrades to the default on read
rather than throwing mid-render.

The column is nullable and nothing was backfilled, so every existing org inherits the deployment
default exactly as before. Routed through it today: the backlog's due-date bucketing
(`getOrgBacklog` → `daysUntil`/`dueBucketFor`, which now take an optional `tz`) and the delivery
trend's day buckets (`getOrgDeliveryTrend` → `buildDeliveryTrend`). Other surfaces still resolve
via the deployment default until they are threaded the same way.

**Not yet routed through the policy** (each still uses its own frame; safe under the UTC
default, would diverge the moment `ASCENT_ORG_TZ` is set):
`src/lib/db/org-rollup.ts`'s `localDayKey` (server-local, the trend day-key axis),
`src/lib/db/usage.ts`'s `dayKey` (UTC), and the client-side `daysUntil` in
`src/features/inflight/live/LiveWarRoomHeader.tsx` (genuinely viewer-local, and therefore able
to disagree with the server's bucket by a day).

## Executive briefing (`src/lib/org/briefing.ts`)

`buildExecBriefing(org, window, periodTitle, segmentId, techGroupId)` is pure assembly over the
rollups above. **Three surfaces render the same `ExecBriefing`** and must never disagree: the
Briefing tab (`src/app/org/[slug]/executive/page.tsx`), the board PDF
(`GET /api/org/briefing/pdf` → `src/lib/pdf/briefing-document.tsx`), and the "Copy for LLM"
markdown (`briefingMarkdown`). The anonymous share link (`/share/briefing/[token]`) re-runs the
same builder against the token's window.

### The trajectory clause states its basis, or it refuses to project (MC-B1, 2026-08-31)

The briefing's Trajectory line consults the **same presentability gate** every other forecast surface
does — `isProjectable` / `forecastInsufficiency` in `src/lib/maturity/forecast.ts`: at least
`MIN_FORECAST_POINTS` (3) distinct scan days **and** `MIN_FORECAST_SPAN_DAYS` (14) of calendar span.
One composer, `composeTrajectory(forecast)`, decides what may be said, and `buildExecBriefing` spreads
its answer onto four fields:

| Field | When set | Renders as |
| --- | --- | --- |
| `forecastHeadline` | only when the fit clears the gate | "On track to reach L4 · Optimizing in ~8 weeks (≈ 2026-09-20)." |
| `forecastConfidence` | **exactly** when `forecastHeadline` is | "trend confidence 34% · noisy" (`< 50` R² is noisy) |
| `forecastBasis` | **exactly** when `forecastHeadline` is | "fit over 9 scan days across 84 days[, 3 of them compacted]" (`forecastBasis`) |
| `forecastInsufficiency` | a fit exists but is below the gate | "Not enough history to project: 2 distinct scan days …" — `forecastInsufficiency`'s sentence *verbatim*, the same words the Delivery fit readout and `/trends` print |

All four null means **no fit at all**, and the renderers say "Not enough history yet to project a
trajectory." The basis degrades to **absence, never to a fabricated one** (G4).

Every renderer reads the line through `briefingTrajectory(b)` / `briefingTrajectoryNote(b)` rather
than assembling its own — the Trajectory card, the board PDF, the share page, the markdown and the
deterministic narrative — so the four artifacts a board might see cannot disagree about one fit.
Confidence and basis are non-null *by construction* whenever a headline is, so a renderer cannot print
the claim and drop the caveat.

This replaced the inverse behavior, found three UAT cycles running (`DANA-L1-001`): on `lowData` the
briefing **nulled** `forecastConfidence` and each renderer guarded its hedge on that null, so the least
trustworthy fit rendered the most confidently — a live board PDF read "Trajectory: Climbing at +35/wk"
off two scan days with no confidence line at all, while the Delivery tab one click away refused the
same claim. `forecastBasis` — which composes exactly the missing sentence and is unit-tested three
ways — had **zero non-test callers** despite a docstring naming one; `composeTrajectory` is that
caller.

**The personal workspace is behind the same gate** (`MC-B34`, 2026-08-31). `PersonalOverview`
filtered its per-repo trajectory cards on `r.forecast !== null` — existence, not presentability — so a
fit resting on two scan days over three calendar days still rendered a projection card, hedged by the
card's own low-data caveat but not held to the org's rule. It was the last forecast surface deciding
that for itself. It now maps each tracked repo through `composeTrajectory` and renders the card only
on a `headline`; a sub-gate fit renders the `insufficiency` sentence **verbatim** — the same words
`/trends` and the Delivery readout print — rather than disappearing, because a tracked repo whose
neighbours have a panel and it does not, with no reason given, is the failure this sentence exists to
prevent. A repo with no fit at all still renders nothing: absence is not a refusal to explain.
`PersonalOverview.gate.test.ts` pins the predicate at the source, since the component is an async
server component and what must not regress is what it filters on.

**The compaction clause is wired but presently silent on the org path** (`DANA-L1-014`): `getOrgRollup`
fits over retained `Scan` rows only and never sets `SeriesPoint.compacted`, so `compactedPoints` is 0
there by construction and ", N of them compacted" cannot yet appear on a briefing. The clause travels
end-to-end the moment that series carries compacted points (it is covered by tests that feed one in),
and it is deliberately **not** synthesised from the org-level `getCompactionCoverage`, which counts
digests across the org rather than the points behind *this* fit — that would be a fabricated basis,
which G4 forbids more strongly than an absent one. The user-visible consequence on a purged-history
org remains unverified: no fixture with a compacted tail exists on the test host.

**Share links are per-grant, and say whether their figures still hold.** Every mint stamps a random
`jti` (`signBriefingShareToken`, returned by `POST /api/org/briefing/share`), so one leaked link can
be killed on its own by bumping `briefingShareRevocationKey(jti)` in the permanent SessionRevocation
ledger — the pre-existing lever (demote the minter) revoked that person's *entire* set. The shared
page enforces it on read and fails closed. The mint and every open are recorded as
`briefing.share.minted` / `briefing.share.opened` audit rows carrying the `jti`, so "does this grant
exist, and was it read" is answerable; the revocation state deliberately does **not** live in
`AuditLog`, because `retentionAuditDays` purging a revocation row would silently un-revoke a link.

An owner drives both halves from the API:

| Call | Does |
| --- | --- |
| `GET /api/org/briefing/share?org=slug&limit=n` | Lists the grants issued — `jti`, minted-at/by, expiry, frozen window, segment/stack scope, open count, and whether each is `revoked` or `expired`. Reconstructed from the mint/open audit rows (`listBriefingShareGrants`, `src/lib/db/org-share.ts`), not a second store. |
| `POST /api/org/briefing/share/revoke { org, jti }` | Kills that one grant by bumping its ledger key. Idempotent; 503 without a database and 500 on a failed write, because "revoked" must never be claimed over a write that didn't land. |

Both are gated exactly like the mint route: **any owner**, same-origin. Not members (revoking a
colleague's live board link is a DoS), and not only the minter (that strands the org the day they
leave — the situation where a leaked link most needs killing). The list is bounded by audit
retention while revocation is permanent, so it is the owner's *inventory*, never the enforcement
point — enforcement is the ledger check on the shared page. That is also why a revoke does **not**
require its grant to still appear in the list.

The revocation lookup has **one** implementation for both link kinds:
`isBriefingShareRevoked` / `isLiveShareRevoked` in `src/lib/db/org-share.ts`, differing only by
namespace prefix, and failing **closed** by construction (an unreachable ledger reads as revoked).
A second copy of a revocation check is how one surface starts honouring revocations the other
ignores.

**Known gap:** `src/app/share/briefing/[token]/page.tsx` still performs that lookup inline
(`getSessionVersion(briefingShareRevocationKey(jti)) > 0`, with its own `.catch(() => true)`)
instead of calling `isBriefingShareRevoked`. Same result today; it is the copy the consolidation
exists to remove.

The page is a **live re-render of a frozen period, not a stored document**, and now says so. The
token carries `briefingFigureDigest(b)`, a fingerprint of the figures the sender saw; the page
recomputes it and renders "figures unchanged since this link was created" or a "Figures moved"
banner above the numbers. A snapshot was considered and rejected: it would be a new stored artifact
holding fleet-wide posture that both the retention floor and the erasure path would have to reach,
and it goes stale invisibly. Now that the window is frozen as absolute instants, a re-scan is already
excluded from the rollup — what still moves under a recipient is the benchmark corpus, goals,
recommendations, the practice proof, the repo set, and retention deleting scans inside the window.
The digest catches all of those; a pinned scan set would catch none of them. A token minted before
this change carries no fingerprint and reads as *unverifiable*, never as "unchanged".

**One ranked source for "what to do next" (G5-02).** The briefing carries
`recommendations: OrgRec[]`, the top-5 `getOrgRecommendations` rows, fetched once inside
`buildExecBriefing` under the same segment/stack scope as everything else. Read it through
`briefingNextMove(b)`, and render the sentence with `nextMoveLine(rec)`. Previously the page
queried this itself while the export path kept an older `risks[0] ?? b.security` heuristic: on a
small, high-scoring fleet with an empty `risks` list the PDF and the markdown printed the security
dimension as "the fleet's weakest dimension" **even when it was the fleet's strongest**, a board
document naming a strength as the weakness. There is deliberately **no dimension fallback** now: an
empty list means the section is omitted, never replaced by a second notion of "weakest".

**Window resolution matches the page (G5-10).** The PDF route resolves its window with
`resolveOrgWindow` (`src/lib/org/period.ts`), the same cookie-aware precedence every org tab uses:
explicit `?range=` › the remembered-period cookie › the default. It previously called the
cookie-blind `resolveWindow`, so a bookmarked or shared PDF URL with no `?range=` silently exported
the 90d default while the page beside it showed the org's remembered period. Boundary arithmetic is
inherited unchanged from the canonical time-zone policy above.

**Download affordance (G5-23).** The Briefing tab's "Download PDF" uses `DownloadButton`, not a bare
anchor: the render is CPU-bound (`maxDuration = 60`) and every error branch returns JSON, which a
plain anchor would display as the whole page. Same treatment as the Security tab's export.

### Impact ledger — what the loop bought (W1d, 2026-08-14)

The Briefing tab opens the rail's fourth question ("what did the last period buy us?") with the
**Impact ledger** (`src/features/bought/executive/ImpactLedger.tsx` over
`src/lib/db/org-impact.ts`). It aggregates the improvement loop's own bookends: each row is a starter
PR the org accepted on the Live wall, merged, and then re-scanned, and the number beside it is
`ImprovementPr.impactDim`: the measured delta on the dimension that PR was aimed at, first
post-merge scan against the repo's scan when the PR opened.

**It reads `ImprovementPr` directly rather than riding on `ExecBriefing`.** That is deliberate: the
three surfaces above all render from the briefing object, and this is an authenticated in-app panel
that must not reach the public share page or the board PDF. It is scoped to the same
`resolveOrgWindow` period as the rest of the tab, and a read failure degrades the panel away rather
than failing the tab.

**Four honesty rules, pinned in `org-impact.test.ts` (model) and `ImpactLedger.dom.test.tsx` (render):**

1. **Verified only.** A merged PR whose post-merge rescan hasn't landed contributes nothing; it is
   counted and named as "awaiting rescan". A projection is not a purchase.
2. **Null, never zero.** With nothing verified the headline is an em dash and a reason: "we
   delivered 0 points" and "we haven't measured yet" are different statements.
3. **Sign-aware, never netted away.** `regressions` counts verified rows whose dimension moved DOWN
   on their own tile, so a negative row cannot hide inside a positive total (UAT `DANA-L1-010`).
4. **No cross-repo overall sum.** `impactOverall` is one repo's overall delta; adding those across
   repos produces a number with no referent. It is shown per row only, and the field notes say so.

Distinct from the **rollout proof banner** directly above it (`briefing.proof`, from
`buildPracticeLibrarySummary().rollout`): that is a one-line *breadth* read of practice rollout (how
many practices travelled, mean lift across them); the ledger is the per-PR *statement of account*.

### LLM narrative (`src/lib/org/briefing-narrative.ts`, G5-03)

The board PDF may open with a short LLM-written narrative. Because a briefing PDF is the surface most
likely to leave the building unedited, this is not a general "summarize it" call: three guarantees
are enforced in code:

1. **Grounded by construction.** The only input the model sees is `narrativeFacts(b)`: the
   briefing's own markdown (minus the trailing `## Ask`, which is an instruction, not a fact).
2. **No new numbers.** Every numeric token in the returned prose must already be in the briefing:
   `isGrounded(text, allowedNumbers(b))`, where `allowedNumbers` unions the numbers in the briefing
   object with the ones the markdown prints. One invented figure (including one the model *derived*,
   like a coverage percentage) discards the whole narrative. The model chooses emphasis and wording;
   never a quantity.

   **No borrowed numbers either.** Membership is not referential integrity: "security scored 62"
   cleared that check when 62 was the *overall* score, because 62 is somewhere in the briefing — every
   number true and the sentence false. `referentGrounded(text, b)` adds the binding: `figuresByReferent(b)`
   maps each named subject (a dimension by label or id, plus `overall` / `adoption` / `rigor` /
   `percentile`) to the figures it legitimately carries, and a figure standing within
   `REFERENT_WORD_WINDOW` (3) words of a named subject must be one of *that* subject's. Deliberately
   narrow: a figure with no home in the briefing (repo counts, corpus size, a forecast horizon) and one
   whose subject is named further away are left to the membership check alone, because a wider window
   rejects valid prose and would push the feature onto the fallback permanently.
3. **Degrades to deterministic copy.** Unconfigured, disabled, non-2xx, refusal, timeout, malformed,
   markdown-structured, tag-leaking, or ungrounded ⇒ `deterministicNarrative(b)`, assembled from the
   same figures by template. There is no error state to render.

**Off by default**, requiring both `BRIEFING_NARRATIVE=1` and `ANTHROPIC_API_KEY`; with neither
(the default, including CI) the module performs no network I/O. `BRIEFING_NARRATIVE_MODEL` and
`BRIEFING_NARRATIVE_TIMEOUT_MS` (default 20s) tune it. Transport is raw `fetch` against the Anthropic
Messages API, matching `src/lib/llm/openai.ts`'s "no SDK dependency added" convention and reusing the
scan providers' `withLlmTimeout`.

`ExecBriefing.narrative` is **not** populated by `buildExecBriefing`; a deliverable opts in via
`attachBriefingNarrative(b)`. Only the PDF route does, deliberately: the "Copy for LLM" markdown is
consumed by another model, which gains nothing from prose we generated for it.

## Getting repos into an org

| Route | Method | Role |
| --- | --- | --- |
| `/api/org/import` | `POST` (SSE) | Bulk-import: list an org's public repos, scan each, persist, optionally watch + schedule. Powers free-tier onboarding without installing the App. |
| `/api/org/scan` | `POST` (SSE) | Scan every **watched** repo (uses the installation token for private repos). Drives `OrgScanButton`. |
| `/api/org/watch` | `POST` | Toggle a repo's `watched` flag (`setRepoWatch`). |
| `/api/org/schedule` | `POST` | Set a repo's autoscan period off/daily/weekly/monthly (`setRepoSchedule`, computes `nextScanAt`). Drives the rescan [cron](../fleet/rescan.md). |
| `/api/org/repos` | `GET` | List an org's public repos (onboarding picker). |
| `/api/org/export` | `GET` | `kind=contributors\|delivery\|passports\|teams` as JSON or CSV (`format=csv`), gated by `requireOrgRead` and scoped by `segment`/`stack`. `kind=contributors` returns **403** below the 3-contributor naming floor rather than a header-only CSV: a CSV carries no scope marker once it leaves the app. |
| `/api/org/segments` | `GET` / `POST` | List an org's segments (with repo counts) / create one (`listSegments` / `createSegment`). |
| `/api/org/segments/[id]` | `PATCH` / `DELETE` | Rename or recolor / delete a segment and its memberships (`updateSegment` / `deleteSegment`). |
| `/api/org/segments/[id]/repos` | `POST` | Tag/untag a repo into a segment (`setRepoSegment`, org-scoped). |

## Audit log

| Route | Method | Role |
| --- | --- | --- |
| `/api/audit` | `GET` | `?org=&action=&cursor=&limit=` → `{ entries, nextCursor }`. Keyset pagination, filterable by action, org-scoped. Each entry carries `integrity`, the per-row HMAC verdict (`ok` \| `tampered` \| `unsigned` \| `no-secret`) recomputed on read, so tamper-evidence is actually *checked* rather than only written. `format=csv` carries it as a column. |

Recorded actions include `scan.created`, `recommendation.status_changed`,
`practice.pr_opened`, `scan.regression`, `retention.purged`.
`src/features/admin/audit/AuditLogViewer.tsx` is the searchable, paginated client viewer.

## Membership, roles & invites

Org membership and role enforcement are wired end to end, backed by the `User` /
`Membership` models and enforced through `src/lib/authz.ts`:

- **Roles**: `owner` / `admin` / `member` / `viewer` (`OrgRole`, `src/lib/db/members.ts`),
  checked with `roleAtLeast`. `requireOrgRole(org, min)` gates owner/admin-only mutations
  (billing, member admin, destructive deletes); `requireOrgAccess`/`requireOrgRead` gate
  "any member" writes and reads respectively. Under the Supabase login wall
  (`authGateEnabled()`), the shared `viewerOrgRole` resolver seeds an owner only for an
  identity-verified viewer: their own personal namespace, or a GitHub-confirmed org admin
  via the App installation, never for the first stranger to touch an ownerless org.
- **Invites**: `GET`/`POST`/`DELETE /api/org/invites` (owner-only, `src/app/api/org/invites/route.ts`)
  list, create, and revoke single-use invite tokens (role capped at `admin`; `owner` can
  only be conferred by promoting an existing member, not minted as a link). Acceptance is a
  same-origin, signed-in-only `POST /api/org/invites/accept` (`src/app/api/org/invites/accept/route.ts`),
  deliberately not a GET-on-render, since a GET would let link-prefetch/unfurlers burn the
  invite. `src/app/invite/[token]/page.tsx` is the UI that collects the token and fires the
  accept POST. Both create and accept are recorded to the audit log
  (`org.member.invited`, `org.member.invite_accepted`).
- **The invite is now delivered** (G7-02): creating an invite with an `email` sends **one**
  transactional message to that address via the shared email transport (`src/lib/email/invite.ts`).
  *Trigger*: an owner's `POST /api/org/invites` with `email` set. *Recipient*: only that address.
  *Opt-out*: `notify: false` in the same request; deployment-wide, `EMAIL_INVITES=off`, and the whole
  path is inert with no email provider (`SES_FROM_EMAIL` unset). There is no list and no repeat send,
  so there is nothing to unsubscribe from; the mail says exactly that.
  The address is **not verified** (an owner typed it), so the mail discloses only the org slug, the
  role, the inviting login, the link and the expiry (no scores, repos, or member list), and accepting
  still requires the accepter's Supabase-**confirmed** email to match the pin (`acceptInvite`), so a
  misdirected message cannot hand a stranger the role. The response reports `emailed`:
  `"sent" | "skipped" | "failed" | null`, and the invite + token are returned either way, so the
  owner's manual copy/paste path is never lost. The audit entry records the outcome.

### Delivery outcomes — the AI-vs-human failure split (W4, 2026-08-14)

Ascent could already say a change was **reverted** (a git fact). It could not say whether anything
**broke**. `Deployment`, ingested from the GitHub Deployments API during a scan through the
installation token the scan already holds, is the outcome anchor. No new vendor, no new secret.

Surfaced as **Delivery outcomes** on the Delivery tab: deployment frequency, change-failure rate,
time-to-next-success, and the split this wave exists for: *do AI-attributed changes fail more than
human-authored ones?*

**Attribution is an equality, not a guess.** A deployment names the sha it shipped;
`AiChange.mergeCommitSha` and the **merge-sha index** carry the shas of merged PRs. The link is
`deployment.sha === merge sha`. The tempting alternative (*"the PR that merged closest before this
deploy"*) is a time-window heuristic, and under the most quotable number this product can produce a
wrong attribution is not a rounding error, it is the whole claim.

**The merge-sha index is why the human bucket exists at all.** `AiChange` stores *only*
AI-attributed PRs by construction (the [evidence pack](#change-management-evidence-pack-w2-2026-08-14)
depends on that), so a deployment failing to match an AI sha would be indistinguishable between "a
human wrote it" and "we could not attribute it". `PrStats.mergedShas`, one `{s, a}` entry per merged
PR riding inside the existing `Scan.prStats` blob and built from `mergeCommit.oid` that W5's revert
linkage has paged and discarded since it shipped, carries every merged PR with its AI flag. No new
column, no extra API call.

**Four limits, all rendered on the panel rather than documented away:**

1. **"Failure" means the deployment failed**, not "caused an incident". Only the first is
   observable here, and *change failure rate* is a term of art a reader hears as the second.
   "Time to next success" is likewise a proxy for restore time, labelled as one.
2. **Attribution coverage is printed.** A split over 12 of 51 deployments means something very
   different from one over 49. Unattributed deployments (merge trains, tag deploys, pre-W4 scans) are
   excluded from the split and **counted**, never defaulted into a bucket.
3. **The human bucket is contaminated in AI's favour.** Unmarked AI assistance is invisible to the
   detector and lands there, so a measured "AI fails more" is *conservative*, and an "AI fails less"
   should be read with that in mind.
4. **No rate under `MIN_DEPLOYMENTS` (5).** One bad deploy out of one is not a 100% failure rate, and
   the gap is withheld entirely unless **both** buckets clear the floor: one side unknown makes the
   difference unknowable, which is not the same as zero.

A deployment with no status is stored as `pending`, never assumed successful (which would understate
failure) or failed (which would invent one). Deployment ingest is best-effort and never blocks or
fails a scan: no token or no deployments yields no rows, and the panel says "not measured".

### Unit economics — what a unit of AI work costs (W3a, 2026-08-14)

`AiUsageRecord` answers *"what did this repo's AI cost on Tuesday"*. It structurally cannot answer
*"what does a unit of work cost"*, because a day bucket has no notion of an **attempt**, and that is
the metric Port's AI-SDLC research says orgs get wrong by measuring adoption instead of outcomes.
Agents bill per attempt, so a 30% no-output rate makes the real cost per completed unit ~1.43× the
naive per-session figure.

`AgentSession` is the attempt: one row per Claude Code `session.id`, folded out of the **same** OTLP
export the day-buckets come from (`src/lib/integrations/sessions.ts`), carrying tokens, cost,
commits, pull requests and lines as the agent itself reported them. Surfaced as the **Unit economics**
panel on Delivery, in its own Suspense boundary (it is a windowed read; the rest of the tab is not).

**Three refusals define the panel:**

1. **No session is called a failure.** A session with no commit is very often a question, a code read
   or a debugging pass. There is deliberately **no `outcome` enum** on the table; the counts are
   stored and the read says *"produced code"* / *"did not"*, leaving the judgement to someone who
   knows their own team. Naming those sessions "abandoned" would be an over-claim about the most
   common kind of session there is.
2. **No per-PR cost is claimed.** The telemetry carries no pull-request id, so a session→`AiChange`
   link would be a repo-plus-time-window guess: a heuristic wearing a precise number's clothes.
   The join is made at **repo × period**, where both sides are counted: agent spend in a repo over a
   period ÷ AI-attributed merged PRs in that same repo and period. It is labelled an allocation and
   its denominator is printed beside it.
3. **No division by zero reads as free.** A repo that merged no AI-attributed change in the window
   has *no denominator*: an em dash. The fleet ratio excludes those repos and **says how many it
   excluded**, because dropping them silently would understate spend while including them would send
   the figure toward infinity.

The denominator is counted from `AiChange`, the same population the
[evidence pack](#change-management-evidence-pack-w2-2026-08-14) reports, so the ROI arithmetic and
the audit artifact can never disagree about how many AI changes shipped.

An exporter that predates the `session.id` attribute yields zero attempts and keeps working exactly
as before; the ingest response returns `sessions: 0` beside a non-zero `stored`, which is the
actionable signal that attribution is missing.

## Provider integrations (`org/[slug]/integrations`, owner-only)

Connects AI coding providers so the **AI delivery** views run on real usage. One card per
provider from the registry (`src/lib/integrations/providers.ts`), each declaring the best
per-repo **fidelity** it can reach:

| Fidelity | Provider | What it means |
| --- | --- | --- |
| `measured` | Claude Code (available) | Spend attributed to the exact repo, via the OTel `git.repository` resource attribute. |
| `allocated` | OpenAI · Codex (planned) | Reported above repo level; distributed by git-attributed AI volume. |
| `seats-only` | GitHub Copilot (available, **W3b**) | Seats and daily engagement, **no spend**: GitHub exposes no per-seat price through any API. |

**`seats-only` is not a lesser `allocated`; it is a different fact.** The Copilot connector stores
real org-level records whose `costCents` is legitimately 0, which is why `OrgUsageRollup`
distinguishes `hasAllocated` from **`hasAllocatedCost`**. Without that split, the ROI model's
allocated branch would divide a zero total across every repository and render the whole fleet as
"$0 spend / shadow AI": connected-looking, confident, and entirely wrong. `POST
/api/integrations/copilot/sync` (owner-only, via the org's App installation) says so in its own
success response rather than leaving the operator to wonder why no money appeared.

**Two vocabularies, one typed mapping (2026-08-20).** `Fidelity` (above) states what a *connector*
can do; `ModelFidelity` (`measured | allocated | none`, in `aiDeliveryTypes.ts`) states what the built
delivery model ended up *with*. They stay separate on purpose — `seats-only` is a capability, `none`
is an outcome, and `none` is also reachable with nothing connected at all — but the correspondence is
now a total `Record<Fidelity, ModelFidelity>` (`modelFidelityOfConnector`, with the reverse
`CONNECTOR_TIERS_BEHIND`), so adding a tier to either vocabulary is a compile error until it is
mapped. Previously the alignment was maintained by hand, and the money columns depend on it.

**Provenance travels per figure, not per model (2026-08-20).** The delivery model's `fidelity` scalar
badges the **spend layer only**; `model.provenance` carries a tier per figure group — `adoption`
(always `git-measured`: PR volume, AI involvement, review coverage), `spend` (the connector tier) and
`mixed` (cost-per-AI-PR, which takes the *weaker* of its two inputs). `FIGURE_GROUP_OF` names which
group each published field belongs to and `provenanceOfFigure` answers for one field, so a surface
showing a measured adoption rate beside an allocated cost figure no longer badges both the same and
force the reader to either distrust a solid number or trust an estimated one. Grouping (three badges,
not one per cell) is deliberate: per-field badges get suppressed by the next designer who touches the
surface.

**The `simulated` tier is gone (W3c).** It filled the spend columns from an FNV hash of the
repository name: plausible dollars, seat counts and plan assignments no provider ever reported.
The UI blurred them, but the *model* still produced them, so every derived total (annual spend, idle
spend, ungoverned spend, cost per AI PR) was arithmetic over fabricated input, precisely what
[`VALUE-CASE.md`](../../VALUE-CASE.md) D32 forbids. The tier is now `none`: the spend layer is
absent, money cells render empty with a connect prompt, and the two spend-derived verdicts
(`shadow`, `idle`) are withheld. A test pins that spend cannot vary with a repository's name.

**The ingest surface** (`src/app/api/integrations/ingest`, plus `/v1/metrics` and `/v1/logs`)
is the app's only internet-facing, body-accepting endpoint authenticated by nothing but a
bearer token, so it carries the same guards as the rest of the public funnel: all three
routes share one front door, `guardIngest` in `src/lib/integrations/ingest-guard.ts`:

| Guard | Behavior |
| --- | --- |
| Rate limit | `INGEST_RATE_LIMIT` layered on the shared limiter (`src/lib/rate-limit.ts`): per-IP burst 3,000/min + a 20,000/min per-instance global, both env-overridable (`RATE_LIMIT_INGEST_PER_IP` / `_GLOBAL`). Derived from Claude Code's real push cadence: metrics flush every 60s and logs every 5s **per developer machine**, so a 200-seat org behind one egress IP legitimately produces ~2,600 req/min. Charged **before** token verification, so a flood is refused without spending crypto. |
| Body cap | `MAX_BODY` = 1 MB, checked against a declared `content-length` first and then by streamed byte count, so an oversized push is refused (**413**) after one chunk rather than buffered. Applies to the accept-and-discard paths too (the protobuf drain, `/v1/logs`). |
| Token | `parseIngestToken` re-derives the HMAC from the slug **and minted epoch** in the token; constant-time compare, then the epoch is checked against the org's stored one. Runs **before** any body/wire-format handling, so a bad-token protobuf push gets 401, never 415. |

### Token rotation (`Organization.ingestTokenEpoch`)

The token is designed to be copied: into a shell profile, a CI secret, a Slack thread by mistake.
It carries the per-org **revocation epoch** it was minted at, the same version-bump shape
`SessionRevocation` uses for the session cookie's `sv`:

| Epoch | Token |
| --- | --- |
| 0 (never rotated) | `asc_otel.<slug>.<mac>`, `mac = HMAC(secret, "otel:<slug>")`, byte-for-byte the pre-rotation format, so **no org re-onboards** |
| N | `asc_otel.<slug>.e<N>.<mac>`, `mac = HMAC(secret, "otel:<slug>:e<N>")` |

The epoch is inside the signed material, so an old mac can't be relabelled with a higher epoch.
**Regenerate token** on the Integrations page (owner-only, behind an inline confirm that states the
consequence: every exporter still using the old token starts getting 401s on its next push, with no
queue or recovery) POSTs `/api/integrations/token { org, rotate: true }`, which bumps the epoch, audits
the act (`integrations.token.rotate`) and returns the new token. The panel re-renders the masked field,
the env snippet and the Test button from that response, so the owner copies a working configuration
**without a reload**, which matters because the response is the only place the new token exists.

**The mask is real, not decorative.** One `Reveal` control governs *both* rendered surfaces, the token
field and the `ENVIRONMENT` block, because the snippet used to interpolate the full token
(`…HEADERS=Authorization=Bearer asc_otel.<slug>.<mac>`) three lines below a field showing bullets, so
screenshotting or screen-sharing the page leaked the credential the owner believed was hidden. Masking
stops at the display: **Copy always puts the working token on the clipboard**, on the field and on the
snippet alike, since a clipboard full of `•` would be a worse failure than the leak. Both
representations come from one pair of functions (`src/features/admin/integrations/envSnippet.ts`), so
there is no per-surface masking rule to drift. Pinned by
`src/features/admin/integrations/ClaudeCodeSetup.dom.test.tsx`, which asserts the raw mac is absent
from the entire rendered DOM while masked and present after reveal.

Rotating `INTEGRATIONS_INGEST_SECRET` still works as the break-glass for **all** orgs at once.
If the stored epoch can't be read while a DB is configured, ingest answers **503**, never a
fall-back-to-0 that would resurrect the token the owner just revoked.

### Reporting what actually landed

An integration that receives forty datapoints and stores zero used to look, on this page, exactly
like one that is working. Three independent paths drop data, and all three are now **counted and
reported** rather than silently skipped:

| Reason | What it means |
| --- | --- |
| `unknown-metric` | The datapoint's metric is outside the three-name allowlist (`claude_code.token.usage` / `.cost.usage` / `.session.count`). Its **value** is dropped. Widening the allowlist is a non-goal; reporting the drop is the point. |
| `no-repo-attr` | The resource carries no `git.repository`, so the spend can't be attributed to a repository. |
| `unsupported-host` | The remote resolves to a forge Ascent has no adapter for — Bitbucket, Azure DevOps, an unrecognized self-hosted host. **GitLab remotes no longer land here** (moonshot #4): `resolveGitRepo` routes through the forge registry, so `gitlab.com/group/project` resolves to `gitlab:group/project` — the same identity a GitLab scan persists — and its spend joins the repo row. What remains genuinely unreadable still **names the host** so the report is actionable, and never silently vanishes. See [`docs/features/github/forges.md`](../github/forges.md). |

`parseOtlpMetrics` returns `{ records, received, skipped, unsupportedHosts }`, and the **202 body
carries `received` / `stored` / `skipped`-by-reason** plus a plain-language `note` when anything was
dropped (omitted entirely when nothing was).

Per provider, the Integrations card shows **last received** time and what landed (distinct repos
attributed and cost over the trailing 35 days), read from `AiUsageRecord.updatedAt`
(`getProviderIngestStatus`), so there is **no schema behind it and no second write path to drift**.
Three explicit states: never received; received but **nothing attributed to a repo** (the
previously-invisible failure, called out in orange with the `git.repository` fix); receiving.

`/v1/logs` is exempt: it authenticates and 202-accepts without parsing, deliberately.

`/v1/metrics` **refuses OTLP/protobuf with 415** naming the
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` fix. This is deliberate: Ascent decodes OTLP/JSON only,
and a 202 on a payload it cannot parse would read to the collector as "delivered" while nothing
ever persists. `/v1/logs` authenticates and 202-accepts without parsing; the token/cost signal
lives in metrics; folding log events into usage is a later step.

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/org.ts` | Barrel re-exporting the org rollup/aggregate queries (rollup, movers, recs, benchmark, gaps, practices, contributors, **teams** (`getOrgTeamRollup`/`rollupTeams`), governance, activity, PR signals, discrepancies) from the `org-*.ts` sub-modules above. Each fleet aggregate takes an optional `segmentId` to scope it. |
| `src/lib/db/segments.ts` | User-defined **segments** (`Segment`/`RepoSegment` tags): CRUD + membership, `listTaggableRepos` (the tag manager's repo universe), per-segment summaries, and the side-by-side `compareSegments` (pure diff `buildSegmentComparison`, unit-tested). |
| `src/components/org/shared/SegmentSelector.tsx` · `RepoSegmentsPanel.tsx` · `SegmentComparePicker.tsx` | Overview/Contributors segment filter (its "+ Create a segment →" pointer links to `?tab=segments`) · the Segments-view tag manager · A-vs-B comparison picker. |
| `src/features/standing/tech-stacks/fleetAnalysis.ts` | Pure cross-stack dimension analysis: classification thresholds, per-dimension leader/laggard/spread, and `coverageOf` (what a verdict rests on, see [above](#tech-stacks--dimension-analysis-and-what-each-verdict-rests-on)). |
| `src/features/standing/tech-stacks/analysisShared.tsx` | Shared diagnosis chrome: class pill (de-weightable), `CoverageChip`, 0→100 range bar, plain-language note, the `ConsensusRow`. |
| `src/lib/github/codeowners.ts` | Pure CODEOWNERS → team parser (`parseCodeowners`/`extractTeamOwnership`); run at scan time, persisted as `RepoTeam`. |
| `src/lib/org/timezone.ts` | **The canonical org time-zone policy**: one reference frame (UTC by default, `ASCENT_ORG_TZ`-overridable) for every calendar-day boundary: zoned midnights, calendar-day arithmetic, day keys, date-literal parsing. See [above](#canonical-time-zone-policy-srcliborgtimezonets). |
| `src/lib/window.ts` | Resolves `?range=/from=/to=` into a `ResolvedWindow` (`start`, half-open `endExclusive`, the deprecated `end` compat bound produced by the single `inclusiveEnd()` adapter, labels) using the canonical zone. Pure + isomorphic. `src/lib/org/period.ts` adds the `ascent_period` cookie precedence (`?range` > cookie > default). |
| `src/lib/maturity/forecast.ts` | Linear-fit projection + ETA to next level. |
| `src/lib/org/briefing.ts` | `buildExecBriefing` (the one assembly behind page/PDF/markdown/share), `briefingMarkdown`, and the single ranked next move (`briefingNextMove` / `nextMoveLine`). |
| `src/lib/org/briefing-narrative.ts` | Opt-in, number-grounded LLM narrative for the board PDF, with a deterministic template floor. Off unless `BRIEFING_NARRATIVE=1` + `ANTHROPIC_API_KEY`. |
| `src/components/org/shell/OrgTabNav.tsx` | Persistent nav rail (two-level `SectionRailNav`), grouped by the transition journey. |
| `src/components/OrgSwitcher.tsx` | Org/installation picker (persists active org). |
| `src/features/standing/overview/Trajectory.tsx` | Forecast "GPS" card. Mounted by `/trends` (`TrajectoryPanel`) and the personal overview, **not** by the org Overview tab, whose forward-looking read is the standing strip's sparkline. |
| `src/components/org/shared/OrgScanButton.tsx` | Scan-all-watched button (SSE progress). |
| `src/features/admin/audit/AuditLogViewer.tsx` | Audit trail viewer. |
| `src/components/org/followups/` | The Follow-ups ledger (replaced the Backlog panel 2026-08-17): `FollowupsWorklist` (ranked table, bulk bar), `FollowupsPromptModal` (fix prompt + hand-off), `FollowupHistory` (per-row timeline), `followupsModel.ts` (filters, selection, org-wide spread, `patchStatuses` bulk runner). |
| `src/components/org/backlog/BacklogGroups.tsx` | The grouped Cards + rows + the three empty states (filter-empty is distinct from backlog-empty). |
| `src/components/org/shared/ui.tsx` | Shared org-UI primitives. |
| `src/app/api/org/*` | Active org, repos, import, scan, watch, schedule, segments, **backlog** (`GET ?org=` → `OrgBacklog`) (+ goals/initiatives/simulate; see [plan.md](../org-planning/plan.md)). |
| `src/app/api/recommendations/[id]` | `PATCH` (status / `assigneeLogin` / `targetDate`, recording a `RecommendationEvent` attributed to the signed-in user) · `[id]/events` `GET` → the item's activity timeline. |
| `src/app/api/audit/route.ts` | Audit query endpoint. |

## Mock scores never enter an average (2026-08-03)

A scan run without a model produces a **deterministic mock** score (`engine: "mock"`), a
placeholder floor, not a grade. Anywhere the Overview presents a figure as a *measurement*, mock
rows are excluded from it:

| Figure | Rule |
| --- | --- |
| Fleet masthead `avg`, per-group `avg` (`avgRealScore`) | Averaged over live-scored repos only. **Null, never 0**, when the set has none: the renderers land on the `—` no-score path, because a `0` in `scoreHex(0)` alarm-red reads as a catastrophic grade rather than "not measured". The repo *count* still describes the whole set, and the tooltip names the denominator (`N live-scored · M mock excluded`). |
| Fleet + per-group `avg move` (`avgRealMove`) | Excludes single-scan repos and **engine-transition** deltas, so a mock→live re-scan cannot fake improvement. Pre-existing; the score average now matches its precedent. |
| Corpus percentile (`getOrgBenchmark`) | Both sides filtered to non-`mock` engines at the current rubric version (see above). |

Groups with no live-scored repo sort **last**, not as the worst-scoring cohort. Pinned by
`src/features/standing/overview/fleetAverages.test.ts` (all-mock, mixed, and zero-scored fleets).

## AI stance (Governance tab, W3)

The Governance tab carries a second section under the gate cards: the org's **published AI
stance**, the versioned "what may AI do here" policy artifact (permitted tools/models, no-AI
zones, review requirements per autonomy tier, provenance requirements).

**The honesty rule, narrowed to the truth (moonshot #8, 2026-08-30).** This section used to say the
stance is *never* enforced and the copy must never claim it is. That blanket statement is now false
in one direction and still true in another, so it is replaced by a **per-clause enforcement map**.
The rule itself is unchanged and still binding: never claim a clause is enforced when it is not.

| Clause | Status | What actually happens |
| --- | --- | --- |
| `provenance.requireHumanApproval` | **compiled** | Becomes `minAiGovernedRate` in the admission overlay; a failing repo gets a `provenance` gate failure. |
| Admission `mode: blocked` | **compiled** | Becomes `GatePolicy.forbidAiAuthorship`; failure code `admission`. Skipped when AI activity is unmeasurable. |
| Autonomy tier floors (T0/T1/T2) | **compiled** | `requireProtectedBranch`, `minAiGovernedRate`, `forbidPostures` — see [gate.md](../scanning/gate.md). |
| `reviewTiers` | **proposed** | Rendered as a branch-ruleset proposal (required approvals + code-owner review). Enforced only once an owner applies it. |
| `noAiZones.pathGlobs` | **proposed + advisory** | A CODEOWNERS managed block guarantees a named human *reviews* those paths. CODEOWNERS cannot see who wrote a change, so AI authorship there is still not detected. |
| `noAiZones.repoGlobs` | **observed** | Checkable after the fact: a stance finding when AI attribution shows up in a sealed repo. |
| `permittedTools` | **observed** | Reported after the fact from PR attribution. Nothing in a repository can refuse a tool. |
| `permittedModels` | **declared only** | Not observable — see the Known gap below. |

Everything not marked *compiled* remains declared-vs-observed attribution from existing scan data.
`compileStance` publishes the same split as a machine-readable `unenforceable[]` list, so the
`get_ai_stance` MCP tool tells an agent exactly which clauses only it can honor.

- **Model**: `OrgAiStance` versioned rows (draft → published → superseded; see
  [data-model.md](../data/data-model.md)) with `stanceJson` typed as `AiStance` in `src/lib/types.ts`
  and guarded by `sanitizeStance` (`src/lib/org/stance.ts`, the sibling of `sanitizeGatePolicy`).
  Acknowledgements live on `OrgArtifactAck` (repo ⇄ artifact version, `artifact = "ai-stance"`),
  upserted per repo; `current` / `stale` / `unacked` is derived against the ACTIVE version.
- **Compliance**: pure `evaluateStanceCompliance` (`src/lib/org/stance.ts`) over per-repo facts
  read by `getStanceRepoFacts` (`src/lib/db/org-stance.ts`): observed tool taxonomy + `aiInvolvedRate`
  + W2 `aiTrailerRate` from the latest scan's `prStats`, unapproved MERGED `AiChange` rows, and the
  repo's ack. The fleet assembly (`buildStanceOverview`, `src/lib/org/stance-overview.ts`) **stamps
  the stance version it evaluated**. Repo-scoped no-AI zones are checkable (glob vs fullName);
  **path-scoped zones are advisory-only** (commit file paths aren't ingested) and every surface
  labels them with the shared `PATH_ZONE_ADVISORY_LABEL`.
- **UI** (`src/features/standing/governance/stance/`): `StanceSection` (server) renders the **Perimeter**
  (`StancePerimeter` + `perimeterParts`): checkpoint strip (declared tools/models vs
  observed-undeclared), four tier bands T0→T3 fed by each repo's **real autonomy tier from the
  shared `passport-autonomy` resolver** (repos with no passport are shown as "tier not assessed",
  never defaulted), and the sealed-zones panel. No published stance → the publish-CTA empty state.
  Owners get `StanceEditor` (sibling of `GatePolicyEditor`: save draft / publish vN), an
  ack button per non-current repo, and an "Open AI_POLICY.md PR" control.
- **API**: `/api/org/ai-stance` (member GET; owner POST draft/publish, audit-logged as
  `org.ai_stance` with version + summary), `/api/org/ai-stance/ack` (admin; `org.ai_stance_ack`),
  `/api/org/ai-stance/apply` (admin; opens a draft PR committing `AI_POLICY.md`, rendered by
  `src/lib/org/stance-artifact.ts`, through the shared practices apply machinery; the filename
  deliberately matches the D1 detector's `ai[-_]policy` reward, so adoption lifts D1).

## Agent admission (Governance tab → Perimeter, moonshot #8)

A scan **derives** a repository's autonomy tier from its own artifacts. That is a measurement.
**Admission** is the decision: a recorded, overridable statement of whether an agent may work in a
repository at all — and the only half a gate can enforce. Before this, a derived tier was persisted
on `Repository.passportJson` and there was no way for anyone to decide anything about it, which the
autonomy model's own `DATA_MODEL_GAPS` recorded as a gap. That line is now deleted.

- **Model**: one `RepoAdmission` row per `(orgId, repoFullName)` — the unique key IS the idempotency
  key, so every write is an upsert. `derivedTier` keeps the measurement, `grantedTier` carries the
  grant, and **`decidedBy` separates them**: NULL means "seeded from the measurement, nobody has
  decided", and every surface says exactly that rather than presenting a seed as a decision. Seeded
  lazily on first read, and **only for a repo that has a passport** — a repo with no assessed tier is
  not seeded at all, because a row with `derivedTier: null` and an invented grant would assert a
  grade nobody measured. `mode` is `agents-allowed | assisted-only | blocked`.
- **The compiler**: pure `compileStance()` (`src/lib/org/admission.ts`) turns (stance, admission row,
  repo facts) into a control set: a **tighten-only** `GatePolicy` fragment, a CODEOWNERS managed
  block, a `.ai/manifest.yaml controls.oversight` block, a branch-ruleset proposal, and the
  `unenforceable[]` list above. Two rules run through all of it: the overlay only ever ADDS floors,
  and **a null tier compiles nothing** (not T0, not T3 — the row reads "tier not assessed").
- **A stance publish does not re-decide.** A row keeps the `stanceVersion` it was decided against, is
  recompiled against the ACTIVE stance so the controls reflect current policy, and is flagged
  `staleDecision` so a human is asked to re-affirm rather than being credited with having done so.
- **Writers are proposals, never silent mutations.** `POST /api/org/admission/propose` is a **dry run
  by default**: it reads the repo's existing CODEOWNERS, splices the managed block, and returns the
  unified diff having written nothing; `confirm: true` opens a draft PR with that exact diff. The
  splice is idempotent, so a recompile that changes nothing opens no PR. `openDraftPr`'s
  refuse-to-clobber rule is untouched — the merge-append writer is a sibling module
  (`src/lib/github/admission-write.ts`); see [github-app.md](../github/github-app.md).
- **The one real mutation is reversible.** `POST /api/org/admission/ruleset` creates a branch ruleset
  (owner + same-origin + a typed `confirm` equal to the repository's full name + an observed-vs-
  proposed read first). The created id is stored on `RepoAdmission.rulesetId` and `DELETE` on the same
  route removes it. Audit rows on every path: `org.admission`, `org.admission_propose` (dry runs
  included), `org.admission_ruleset`, `org.admission_ruleset_revert`.
- **Routes are (org, repo), never `[id]`.** Each gates the org and then constrains the caller-supplied
  repo name to it (`repoUnderOrg`), so an authorized owner cannot name another tenant's repository.
  `src/app/api/org/id-routes-gated.test.ts` covers the family structurally.
  **Tenancy is the org's repository set, not a string prefix** (since 2026-08-31; UAT `PRIYA-L2-C5`).
  `repoUnderOrg` used to require `owner === orgSlug`, which holds only for an organization whose slug
  equals its GitHub owner namespace — so an org named for its team could never admit its *own* repos,
  and the remote work protocol was permanently unreachable for it (`kiro` and `xkazm04/*` on the real
  host). It now accepts the owner-namespace match as a fast path and otherwise asks `orgTracksRepo`,
  which reads the `Repository` `(orgId, fullName)` key — the actual tenancy fact, so another tenant's
  repo still matches nothing. Deliberately the **tracked** set, not the `watched` subset: `watched` is
  a rescan-cadence preference, and a governance decision must not depend on whether autoscan is on.
- **The claim door consults the decision.** The MCP `claim_followups` gate resolves the *effective*
  tier from this row (grant beats derived where a tier was assessed) and refuses outright on a `mode`
  below `agents-allowed`. See [org-followups/README.md](../org-followups/README.md) → *Who may claim*.
- **UI**: `src/features/standing/governance/stance/admission/` — the admission column sits under the
  tier bands (the measurement it departs from), with an owner-only override that disables the tier
  select for an unassessed repo and shows the derived value beside the grant whenever they differ.
- **MCP**: `get_ai_stance` takes an optional `repo` and returns that repository's compiled controls,
  admission mode and `unenforceable[]` list. Read-only, `mcp:read`, no new tool, and the `repo`
  argument is constrained to the caller's own org.

## Known gaps

- **`permittedModels` is declared and unchecked, and stays that way.** Not an oversight and not a
  backlog item waiting for effort: no ingest in the product retains a MODEL dimension. `AiUsage` keys
  by `(source, scope, scopeKey, day)`, and PR attribution identifies a tool, not a model. A compiled
  control here would be a bar that can never fire, which an auditor reads as "no violations".
  Enforcing a model allowlist waits for a sensor that observes models. `compileStance` names this in
  its `unenforceable[]` output rather than omitting it, so an agent reading the stance over MCP is
  told the clause is its own to honor.
- **CODEOWNERS reviews; it does not detect.** The managed block guarantees a named human reviews any
  change to a declared no-AI path. It cannot see WHO wrote the change, so a human-approved AI change
  to a sealed path is indistinguishable from a human-written one. The generated block says so in its
  own body rather than letting a reader infer enforcement from its presence.
- (Closed 2026-08-13.) ~~The Overview shows standing, not a punch list.~~ The three-item **Fix
  first** band is back on the Overview (`OverviewFixFirstPanel` → pure `deriveFixFirst` in
  `src/features/standing/overview/fixFirst.ts`), revived from the 2026-08-03 deletion with a cheaper
  input set: worst regresser (`getOrgMovers`), the busiest unresolved derived-findings queue
  (`getOrgFindings`, already `unstable_cache`d for the rail badges, decisions subtracted fresh),
  and the first behind-pace active goal (`listGoals`). It streams in its own `<Suspense>` boundary
  so the fleet panel is never held, drops `getOrgGapAnalysis` (the expensive read that motivated
  the deletion), and renders nothing when there is nothing actionable.

- **No per-contributor drill-down page, deliberately**, and no per-person time-series to build one
  from: `RepoContributor` is uniquely keyed `(repoId, login)` and upserted each scan, so it is a
  *current* snapshot with no history. Two reasons this stays unbuilt rather than "not yet": (1) the
  data doesn't exist: a "this person's trajectory" page could only be faked; (2) the only per-person
  history that *does* exist (`AiChange.authorLogin`) is documented in the schema as internal-only and
  pseudonymized in customer-facing packs, so building a profile page on it would invert an existing
  privacy decision. Team-level drill-down already exists (the expandable `TeamsMatrixDetail` row).
- **No DORA panel, deliberately**: of DORA's four metrics, Ascent ingests neither a deployment feed
  nor an incident feed, so **deployment frequency** and **time to restore** are not derivable at all;
  **lead time for changes** (commit → running in production) is only partially observable as PR
  open→merge latency, which the Delivery trend ships under its true name ("time to merge"); and
  **change failure rate** has only `prStats.revertRate` (a VCS revert, not a production failure)
  behind it. Labelling any of these "DORA" would invite a leader to benchmark a proxy against
  published industry figures. Unblocking it needs GitHub Deployments/Releases ingestion plus an
  incident source: a data-ingestion project, not a dashboard one.
- (Closed 2026-08-30, moonshot #1.) ~~The evidence pack's limitations omit that `environment` is the
  LATEST scan's settings, not the settings as of merge.~~ Every merged row now carries
  `environmentAsOf` with a per-row `source` label, and the pack states its coverage with the
  denominator (see "As-of-merge control environment" above). **The honest remainder:** rows the
  ledger cannot answer for still fall back to latest-scan settings — labelled, counted, and never
  presented as as-of evidence — and any change that merged before the ledger began for a repository
  will always be one of them.
- **No backfill of the control ledger from scan history:** `Scan.governance` blobs predating the
  ledger are not replayed into `ControlObservation`, so an org's as-of coverage starts when the
  ledger does rather than when its scan history does.
- **No regression notifications in the UI**: movers show on the dashboard; push/email
  alerts go through the webhook sink (see [../alerts.md](../fleet/alerts.md)).
- **Org trend is overall-only**: per-dimension org trends over time aren't surfaced yet.
- **Team attribution is CODEOWNERS-only**: `getOrgTeamRollup` keys off each repo's CODEOWNERS
  (`@org/team` owners, parsed at scan time). Repos with no CODEOWNERS team show as "unowned"; the
  GitHub Teams API (GraphQL) as a fallback attribution source is still on the roadmap.
