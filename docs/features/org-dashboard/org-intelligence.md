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
| **Shared** | What do we publish once and every repo consumes? | Registry · Practices · Skills · Memory · Knowledge base · UI surfaces |
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
| Standing | Passports | `org/[slug]/passports` | `src/features/standing/passports/` | **2026-09-05:** the tab's autonomy tier, blocking conditions and progress all come from the one persisted resolver (`deriveAutonomyForStored`); the prototype five-gate ladder is presentation only, so a T2 repo can no longer list gates T2 never consulted. The context gate reads real `contextHealthJson` freshness and an unmeasured freshness costs nothing (the mock staleness penalty is gone). Passport blocker decisions key on `findings[].id`, with a read-side alias for decisions stored under the old prose key until 2027-03-01, so a blocker whose text changes keeps its decision. Repo passports, as three switcher views: **Baseline** (the automation × production portfolio), **Clearance** (the passport as a per-repo security clearance), and **Capabilities** (the declared-vs-proven capability matrix), and **Controls** (the per-check doctor findings each repo's own CI reported back) — both below. |
| Standing | Security | `org/[slug]/security` | `src/features/standing/security/` | Security posture across the fleet, in three stacked pieces: the summary-tile ledger (avg D9 · branch protection · repos at risk · gate), whose bottom edge **is** the D9 band spectrum (`SecurityBandSpectrum`, a `col-span-full` ledger cell — see below); the **D9 check battery** (`SecurityRiskRegister`; renamed from "Control matrix" 2026-08-31, MC-B10); and **Findings to decide** (`SecurityFindings`, see below). |
| Standing | Adoption | `org/[slug]/adoption` | `src/features/standing/adoption/` | Adoption signals: AI-share tiles, the contributor spread bar, tool footprint, champions, per-team adoption and the delivery strip. **Rates, bands and teams — no named per-person roster**; the "Who to enable next" table moved to Contributors (2026-08-19) and the spread bar's "none" follow-up deep-links across to it. **2026-09-05:** the \"Org AI commit share\" tile carries its commit denominator (withheld, not zeroed, below the naming floor); the enablement cohort requires activity within 90 days of the fleet's latest observed activity as well as three commits, and the Contributors tab states that horizon. |
| Standing | Follow-ups | `org/[slug]?tab=followups` | `src/components/org/followups/` | Every open gap across the fleet in one ledger — tick a batch, one fix prompt for a local agent, hand off, and the next default-branch scan closes what landed. Replaced the **Plan** and **Backlog** tabs (retired 2026-08-17). See [org-followups/README.md](../org-followups/README.md). |
| Shared | Practices | `org/[slug]/practices` | `src/app/org/[slug]/practices/page.tsx` | The Practice Library (see [../practices.md](./practices.md)). |
| Shared | Skills | `org/[slug]/skills` | `src/app/org/[slug]/skills/` | Skill drift/dormancy views. |
| Shared | Memory | `org/[slug]/memory` | `src/app/org/[slug]/memory/` | Shared Org Memory browser. |
| Shared | Knowledge base | `org/[slug]?tab=knowledge` | `src/features/shared/knowledge/` | The registry's knowledge lane as the registry structures it (bundle → category → subcategory → subject) and the fleet's standing against it: one cell per subject × swept repo in an eleven-state vocabulary (four verdicts, seven classified absences), a subject reader, and the dispatch composer that hands a repo its next registry stage (populate → map → conform) as a brief or a local run. Reads `?domain=` and `?subject=`. Born inside the `?tab=` shell, so unlike its Shared siblings it has **no** `/org/[slug]/knowledge` route — which is exactly why its id must sit in `MIGRATED_ORG_TAB_IDS`. See [org-knowledge/knowledge-base.md](../org-knowledge/knowledge-base.md). |
| Shared | UI surfaces | `org/[slug]?tab=surfaces` | `src/features/shared/surfaces/` | The registry's ui-surfaces subjects rendered as composed, interactive React/Tailwind/Motion scenes (14 of 33 showcased 2026-09-06): a technique rail, the live scene with one `data-technique` region per technique, and a mechanism drawer (mechanism · source · In Ascent · deviation). Showcases are repo-shipped records in a typed catalog joined at render to the org's index mirror for a digest-freshness badge. Reads `?subject=` and `?technique=` (tab-scoped). Born inside the `?tab=` shell (in `MIGRATED_ORG_TAB_IDS`). Authored by the project-owned `/surface <slug>` skill. See [org-knowledge/surfaces.md](../org-knowledge/surfaces.md). |
| — (header menu) | Developer | `/org/developer` | `src/features/developer/` | UC3 individual care. Reached from the **header identity menu** (your own name), not from the org rail — it is not org-scoped, so it is in `ORG_TABS_NOT_IN_NAV`. Not a `?tab=` panel either: a static route personalized to the signed-in viewer (their commits and AI share, the open gaps of their repos, their private care loop). It renders the same `OrgShell` as every tab, with `activeTab="developer"`. The anonymized org aggregate lives in Contributors, under `CHAMPION_MIN_POP`, never a per-person row — see [developer.md](developer.md). |
| Standing | Governance | `org/[slug]/governance` | `src/features/standing/governance/` | Governance rollups: gate tiles, the editable policy card, fail-reasons, failing repos, the CI snippet, the evidence pack, and the AI stance section. No standfirst under the title, and no "Cheapest path to green" card (both deleted 2026-08-19 — see below). Every panel opens on a shape since the Wave-1 redesign (2026-09-08 — see "Governance, redesigned" below). |
| In flight | Live | `org/[slug]/live` | `src/app/org/[slug]/live/` | Live/war-room view. |
| Bought | Briefing | `org/[slug]/executive` | `src/app/org/[slug]/executive/` | Executive briefing view. |
| Bought | Delivery | `org/[slug]/delivery` | `src/app/org/[slug]/delivery/page.tsx` | PR signals, branch governance, 12-week fleet commit activity, and (2026-07-28) a **Delivery-over-time** section: eleven small-multiple day-by-day panels (review coverage, AI involvement, AI PRs reviewed, AI trailers, AI pre-review, protected default branch, merge rate, small PRs, revert rate, time to first review, time to merge; count corrected 2026-09-05) plus gated slope reads, scoped by the shared org period selector. **W1a (2026-08-12)** surfaced three metrics every scan already persisted (`revertRate`, `medianHoursToFirstReview`, `smallPrRate`) into the signal band, the per-repo table, the trend, and a **review-latency slope** (`hoursToFirstReview` in `DELIVERY_FIT_METRICS`, hours/week with inverted goodness tone): the review-capacity read behind the Assist→Delegate bottleneck. Because the metrics come from the historical `prStats` blobs, the trend back-filled from existing scans day one; a blob written before the fields existed reads null ("not in these scans"), never a fabricated 0. **W2 (2026-08-12)** added two trailer-era attribution metrics from the extended `PR_QUERY` (merge-commit + PR-commit messages, review-author `__typename`): `aiTrailerRate`: share of merged PRs whose commit messages carry an AI attribution trailer (trailer-GROUNDED attribution, vs the self-declared marker rate); and `aiPreReviewedRate`: share of merged PRs an AI/bot reviewer (CodeRabbit, Copilot code review, Greptile, …) reviewed before the first human review. Both surface in the signal band (now 10 cells), the per-repo table, and two new trend panels; both are null on pre-W2 blobs and under the ≥5 merged-PR floor. The AI-delivery ROI model (`aiDeliveryModel.ts`) prefers trailer-grounded counts as its **allocation weight** where present (a commit trailer is tooling-written evidence; markers are self-declared), refining the "allocated" fidelity tier only, complementing (never replacing) the measured per-repo OTel path. "Fix first" adds two derived priorities: a slow first review (>24h, called out against AI PR share) and a fleet revert rate ≥5%. **W5 (2026-08-12)** added `reworkRate` (share of merged PRs later reverted, from revert linkage) to the delivery-trend point keys on the same null-back-fill discipline (data only so far, no dedicated panel yet); the metric's home surface (the Backlog tab's Debt Ledger) retired 2026-08-17 — `getOrgRework` is currently an orphaned read awaiting a Delivery-tab home. Its five rollup queries (PR signals, governance, activity, AI usage, delivery trend) run via `Promise.allSettled`, not `Promise.all`: one query erroring degrades only its own panel (an explicit "couldn't load" banner, not a silent empty state), instead of blanking the whole tab. **2026-09-05:** every PR-rate cell and repo-table row carries the population it was computed over (`rateBasis`, `PrRepoRow.population` — produced since W1a, rendered now); the headline says each rate names its own population; a `SnapshotScopeNotice` states which sections are period-scoped (trend, unit economics, outcomes) and which are latest-scan (PR signals, governance, activity); `derivePriorities` refuses to name a worst reverter under five PRs. Parked: the analyzer-level `revertRate` floor (needs `PrStats.revertRate` widened to `number | null` in `src/lib/types.ts`). **2026-09-08 (/org redesign Wave 1):** the tab was rebuilt on the shared viz kit — unit economics and AI delivery as `FlowRibbon`s whose money stage VOIDS (never zeroes) when no provider reports cost, trend lines that break at unmeasured days, a `ReviewCoverageStrip` above the per-repo table, a `GovernanceGapMatrix` that draws a zero-approval PR rule as `declared`, and DORA as a four-panel small multiple with a bracketed AI-vs-human failure gap. See “Delivery, redesigned” below. |
| Bought | Contributors | `org/[slug]/contributors` | `src/features/bought/contributors/` | AI champions, involvement table (withheld below 3 contributors), **Who to enable next** (`EnablementTargets`, moved here from Adoption 2026-08-19 — see below), an **Org resilience** module (fleet key-person exposure, repo-level only, names nobody), and the per-repo concentration / bus-factor table. **2026-09-05:** the \"You\" strip says attribution is *withheld* below the naming floor instead of \"no commits attributed\"; each section degrades on its own (`allSettled`), so one failed read no longer blanks the tab. **2026-09-08 (redesign Wave 1):** the tab now OPENS on a graphic — an AI-share `Distribution` with the viewer's own position marked — concentration is a `ConcentrationCurve` with the bus-factor knee above the per-repo table, champions are plotted in adoption × volume space, resilience leads with a per-repo top-share quartile strip, the care section leads with a `MatrixGrid` privacy ledger whose per-person column is a column of voids, and a contributor with no commits to take a share OF renders a **void, not a 0% bar**. See [Contributors, redesigned](#contributors-redesigned-the-distribution-is-plotted-wave-1-2026-09-08). |
| Bought | Teams | `org/[slug]/teams` | `src/app/org/[slug]/teams/page.tsx` | Per-team (CODEOWNERS) Adoption×Rigor, dimension shape, AI-knowledge & champions, movers; the org's AI-knowledge leader + a suggested cross-team pairing. **2026-09-05:** per-section degradation; the Δ footnote derives from the period's `deltaLabel`; the AI% cell carries its contributor population in the row; the provenance stamp says \"captured fleet-wide\" under an active filter; the window goes through `orgWindowBounds`. |
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

**Three additions, 2026-08-31 (UAT `PRIYA-L1-04` / `PRIYA-L1-05`), all of them wiring something the
readout already computed:**

- **A `schema <v> ahead` chip.** Spec #13 promised a manifest on an unknown major version would be
  *"parsed leniently, flagged honestly"*. `read.ts` computed `schemaAhead`, `readout.ts` persisted it,
  and nothing under `src/features` read it — so a fleet on a newer schema rendered ordinary cells with
  no hint the reader was behind. The row now carries the flag and its declared version, with the
  consequence in the hover: anything the newer schema added is not represented in the row.
- **A parse-note count.** The reader's `notes[]` — including the **redaction** notes — reached no
  surface, so an operator could not see that a command shown here is not the command the repo wrote.
  The row prints `N parse notes` with the notes themselves on hover.
- **A `Report-back` column** — spec #35 handoff 2's promised one. `getFoundationRollout` had exactly
  one consumer, on the Repositories tab, so "where is the standard in, and where is it proving
  itself?" was a three-tab join living in the reader's head. `PassportsTab` now reads it in the same
  parallel batch (no added round-trip depth) and the column restates the Repositories tab's honest
  nulls rather than re-deriving them: `—` = not in the rollout read, *"not provisioned"* = Ascent
  wrote no report-back secrets (not "off"), *"provisioned · never reported"* = wired but no run has
  reported (**not 0%**), otherwise the reported percentage with its date on hover.

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

**The unjudged row names what SHE declared under it (2026-08-31, UAT `RC-N2`).** The caveat above was
true whether or not the reader had any stake in it, so the strongest version of the original finding —
a lead who had *just* set two required controls — still read a sentence that did not acknowledge her
bar. `unjudgedBarDeclaration(code, policy)` composes the escalation per row from the stored policy:
the `control` row appends *"— you have declared 2 required controls; the per-repo gate enforces them"*
(the count is read from `requireChecks`, never written as a literal), and the `admission` row appends
its own when `forbidAiAuthorship` is set. An org that has declared nothing under a row sees no
escalation — an empty one would be worse than none.

**And an earned zero gets a word of its own (2026-08-31, UAT `RC-N3`).** A structural zero now has a
sentence; a *measured* zero had only the glyph, so the two `provenance` / `governance` rows read as
placeholders beside the two that had changed. `buildGovernanceOverview` publishes two new fields —
`measuredOn` (how many ASSESSED repos actually carried the condition's inputs, counted off the same
snapshot fields `evaluateGateLite` skips on) and `barSet` (whether the org's bar asks for the condition
at all) — and `earnedZeroNote()` turns them into the qualifier beside a 0 row: *"measured on 12 of 14
judged repos"*, or *"not part of this org's bar"* when nobody set it, or *"no judged repo carried the
inputs (0 of 14)"* when the sample is genuinely empty. This **extends** the three-state vocabulary
(guardrail G15); it does not collapse it — `unmeasurable`, `unchecked` and an earned zero stay three
different sentences.

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
| `src/lib/db/org-family-wired.test.ts` | **Structural guard (2026-09-06).** Every exported `get`/`list`/`explain` producer in the family must be called by something outside the family and its barrels, or be named in `UNWIRED` with a reason. An aggregation layer's value is entirely downstream, and a producer nothing calls is a fleet number the product computed and never showed anyone — invisible by construction, since it typechecks, its unit tests pass, and the `org.ts` re-export makes it look consumed. `getOrgGapAnalysis` (the systemic-vs-repo-specific gap split) and `getOrgDiscrepancies` (the detector-calibration backlog) are the two currently declared unwired; both are fully implemented and tested, and two earlier sweep rounds landed correctness fixes inside that blast radius without anything noticing the larger fact. Derived from the code, like `AuditLogCells.actions.test.ts`. |
| `src/lib/db/org-nav-counts.ts` | `getOrgNavCounts`, `getOrgPassportBlockers`, `listOrgRepoNames` (one column, request-cached; the repo picker on the Practices and Skills tabs, which used to buy a full rollup for it). |

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
| Practices / Skills repo picker (2026-09-05) | full `getOrgRollup` for `repos[].fullName` (6 queries, two unbounded scan sweeps) | `listOrgRepoNames` (1 query, 1 column) |
| Repositories tab (2026-09-05) | two full rollups per render (leaderboard scoped, Context Health unscoped, so the lens ignored `?stack=`) | one `getOrgRollupShared` (request-cached on primitive args) feeding both panels with the same scope; 12 → 7 queries |
| `getOrgRollup` itself (2026-09-05) | `include:` at both levels: ~36 Repository + ~39 Scan columns for every scan in history (the nested `take: 1` is applied client-side) | `select:` of the 18 + 11 fields the mapper reads |

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
| `getOrgRollup(slug, window?, segmentId?)` | Latest scan per repo → fleet averages, posture distribution, dimension averages, daily trend, and a linear `Forecast`. **Known gap (2026-09-04): the trend and the badge beside it have different denominators.** `avgOverall` is a mean over REPOS (each repo's latest scan); a trend point is a mean over the SCANS that landed that day. `OverviewLedger` renders them side by side, so on a fleet with mixed cadence the chart's right edge and the number next to it describe different populations — measured at a 23-point gap on a 20-repo fleet where only the 3 daily-autoscanned repos were scanned that day (final point over 3 of 20 repos), and `forecastTrajectory` is fitted to the same series. Both candidate remedies are real product calls (carry each repo's latest score forward per day so the last point equals the badge; or keep the scan-mean and ship each point's `n`, which is the `count-carries-predicate` rule `CohortMovement` in this same file already follows), so it is a deck item, not a sweep fix. With a `window` it also returns a `baseline` snapshot (latest scan per repo as of `window.start`) and per-metric `deltas` for period-over-period tile comparisons; the trend is bounded to the window. An optional `segmentId` scopes every figure to a [segment](#segments)'s tagged repos. |
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
  evidence and does not would draw a conclusion the artifact cannot support. **All three artifacts
  have a named variant on the card** (since 2026-08-31, UAT `NADIA-L1-10`): it used to offer only the
  named *manifest*, while its own justification — *"export it when an examiner needs to re-verify
  specific rows against GitHub"* — is about rows, and the rows live in `sample.csv` and `findings.csv`.
  The route already supported `identities=named` on all three; only the two CSV links passed `false`.
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
  (The card used to spell that framing out in a paragraph above the download links. It is
  documentation, and it lives here; what stays on the card is the disclaimer itself — "Ascent
  certifies nothing; the examiner decides" — beside the lower-bound limitation, in visible text
  rather than a tooltip, because a screenshot crops tooltips and keeps text.)
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

`unmeasurable` renders as an **em dash with a tooltip** in the table and as the shared **hatch** in
the lane picture above it — never a zero, never a red — and is counted separately from "not
operating" in the header. A control we could not read is missing evidence, not a finding; colouring
it like one would turn every expired token into a fleet-wide governance failure on the page a lead
screenshots.

Since 2026-09-08 the card **opens on a `StateTrack`** (`controlLanes.ts`, pure) rather than on a
table header row: one lane per control, UTC-day buckets across the fleet, adjacent days that read
the same way merged into one run. A day nobody observed is a GAP on the dotted ground; a day whose
every observation was unreadable is hatched with no value printed; every other day is coloured by
the share of readable observations that were operating. Lanes are budgeted at eight and the
remainder is **counted on the card** — an omitted lane and an unobserved one must not look alike.
Two sentences that used to sit under the table are now documentation rather than chrome: this card
is **distinct from the Security tab's D9 check battery and from Passports › Doctor checks** (see
*Three catalogues, three names* below), and a red state carries the catalogue's own `failMeans`
sentence (below). The actor caveat — *scan- and probe-sourced rows carry no actor; nobody performed
those in a way we observed* — is a `WhyChip` beside the heading.

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

**Known gap (2026-09-04): three files are still off the semantic type scale.**
`globals.css` says the sweep that introduced `type-*` "replaced every site"; four files in
`src/features` + `src/components/org` were still on raw `text-sm`/`text-[11px]` utilities.
`GuidanceCoherenceCard` was fixed in this context; `src/features/inflight/live/cockpit/LaneRail.tsx`,
`src/features/shared/practices/PracticeDriftStrip.tsx` and
`src/features/shared/practices/RegistryPracticeApply.tsx` remain. The size tokens are re-based +1px,
so a raw `text-sm` renders one pixel under every sibling surface on the same page, and `text-[11px]`
sits below the 12px floor the scale establishes. Converting them is mechanical (the mapping table is
in `globals.css`) with one trap: `type-micro`/`type-note`/`type-body-sm`/`type-lede`/`type-title`
declare SIZE ONLY, while `type-label`/`type-caption`/`type-mono-sm`/`type-figure` also set the mono
family — so a `font-mono` being replaced must stay explicit at the first group.

## Canonical time-zone policy (`src/lib/org/timezone.ts`)

**One closure convention (2026-09-05).** Every org window is half-open, `[start, endExclusive)`. The
UI no longer hand-writes the inclusive `{ start, end }` pair: `orgWindowBounds(period)`
(`src/lib/org/period.ts`) is the single adapter between the cookie-resolved `ResolvedWindow` and the
db layer's `OrgWindow`, and `upperBound()` (`src/lib/db/org-shared.ts`) turns it into
`lt: endExclusive`. Overview, Security, Executive (both the briefing and the Impact Ledger), the
Briefing PDF route, the digest cron and the Teams panel all go through it. The deprecated
`ResolvedWindow.end` is exactly `endExclusive - 1 ms`, so the migration changed no figure on any
surface at millisecond resolution; `src/lib/org/period.dialect.test.ts` replays both dialects over
the same fixture for every period shape and three readers and asserts identical rows while the emitted
SQL changed from `lte` to `lt`. What half-open buys: Postgres keeps microseconds, so a scan landing in
the final millisecond of a period matched the old `lte: end` and the next window's `gte: start`,
counting once on each side of two abutting windows; half-open partitions cleanly.

**What "now" means to each reader, by design.** `getOrgRollup`'s "current" is each repo's latest scan
at-or-before the upper bound with no lower bound (where the fleet stands as of the period's end);
`getOrgMovers` and `getOrgTeamRollup`'s "now" is the latest scan inside the window, compared with the
latest scan strictly before `start` (a move is a measurement, so both endpoints must be real scans);
`getOrgRepoHistories` is every scan in the window. The visible consequence: a repo not scanned during
the period counts in the rollup average and is absent from movers, and the two counts are not expected
to reconcile. Each reader's file header states its rule.

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

**A custom window always names its own bounds (2026-09-06).** `?range=custom` is the one period whose
parameters are not implied by its name, so `resolveWindow` echoes the resolved dates into `title`
(and `reviewTitle`) rather than rendering the opaque "Custom range". That echo used to be gated on
`start` alone — so a window with an unparseable `from` and a valid `to` had no baseline (correctly:
no delta) but a real `endExclusive`, and every figure on the page was clipped at a date the header
hid. It now reads `all time → 2026-03-31`, mirroring the open right edge's `now`; `comparisonLabel`
stays keyed on `start`, because the baseline IS the lower bound. Reachable from a hand-edited link, a
truncated share, or a period cookie written by an older serializer.

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

(Closed 2026-09-04.) ~~`src/lib/db/org-rollup.ts`'s `localDayKey`~~ — the maturity trend's day-key
axis now resolves through `dayKeyInZone`, so the series is bucketed in the same zone the window that
selected its rows was computed in. It had been the one entry on this list that a reader of the CODE
could not discover: the function carried a comment asserting it used "the SAME zone the window
boundaries use (window.ts `startOfDay` snaps to LOCAL midnight)", true when written and false since
window.ts migrated — so the site read as already-correct at the exact place someone would go to fix
it. Measured before the change over three sample instants: 2 of 3 mislabelled under
`ASCENT_ORG_TZ=America/New_York`, 1 of 3 on a non-UTC host under the UTC default.

Its unit test could not have caught it either: the expected day key was computed with the
implementation's own formula, so the assertion held whichever zone the code chose. The oracle is now
derived from the policy (`Intl`, canonical zone) independently of the code under test — worth copying
wherever a zoned bucket is asserted.

**Not yet routed through the policy** (each still uses its own frame; safe under the UTC
default, would diverge the moment `ASCENT_ORG_TZ` is set):
`src/lib/db/usage.ts`'s `dayKey` (UTC), and the client-side `daysUntil` in
`src/features/inflight/live/LiveWarRoomHeader.tsx` (genuinely viewer-local, and therefore able
to disagree with the server's bucket by a day).

## Executive briefing (`src/lib/org/briefing.ts`)

`buildExecBriefing(org, window, periodTitle, segmentId, techGroupId)` is pure assembly over the
rollups above. **Three surfaces render the same `ExecBriefing`** and must never disagree: the
Briefing tab (`src/features/bought/executive/ExecutiveTab.tsx`; `src/app/org/[slug]/executive/page.tsx` is a redirect into the tab shell), the board PDF
(`GET /api/org/briefing/pdf` → `src/lib/pdf/briefing-document.tsx`), and the "Copy for LLM"
markdown (`briefingMarkdown`). The anonymous share link (`/share/briefing/[token]`) re-runs the
same builder against the token's window.

**Two denominators, stated on all four surfaces (2026-09-05).** Coverage (`scanned/total`) answers
"how much was looked at"; the score basis (`realScoredCount`, carried on `ExecBriefing` from the
rollup) answers "what the averages are averaged over". Every basis clause that stands on an average
("across N live-scored repos", "(of N live-scored)", the narrative's "averaged over N live-scored
repositories") uses the live-scored count; the ranked next move keeps the scanned denominator because
its recommendation count reads mock-floored repos too. A fleet with no live-scored repository has
**no grade**: the tab tiles, the PDF Stats, the markdown and the share page print "—" plus a sentence
(never 0/100, never L1), and a prior-period comparison is refused when the prior window scored nothing
live. A separate disclosure, "N mock placeholders excluded from every average", renders beside the
engine-mix caveat on every surface, including the PDF body. All of it is composers in `briefing.ts`
(`briefingHasScore`, `scoreValue`, `briefingLevelCaption`, `noScoreLine`, `scoreBasisLine`,
`mockDisclosure`, `coverageLine`), and the HTML surfaces now call `benchmarkCaption` and
`movementLine` like the PDF always did, so a one-repo corpus reads "not enough peers to rank" rather
than "vs 1 repos", and the coverage line renders on the tab and the share page. Share tokens carry a
half-open `winEndX` beside the unchanged inclusive `winEnd`, so tokens minted before 2026-09-05 still
verify and render identically; the impact ledger's rows carry six cells for their six headers.

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

(Closed; the entry had gone stale, corrected 2026-09-05.) ~~`src/app/share/briefing/[token]/page.tsx`
still performs that lookup inline~~ — the share page imports and calls `isBriefingShareRevoked` from
`@/lib/db/org-share`; the consolidation landed and only this note lagged.

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

**Off by default**: `BRIEFING_NARRATIVE=1` is the only switch; with it unset (the default,
including CI) the module performs no network I/O. `BRIEFING_NARRATIVE_TIMEOUT_MS` (default 20s)
tunes the call. Since 2026-09-05 (BACKLOG C3) the transport is the org-aware seam,
`resolveTextRunnerForOrg(orgSlug, { legKind: "briefing" })`: an org's connected BYOM model writes its
own board paragraph, the platform provider is used only when the org has none, and an active but
unresolvable BYOM falls back to the deterministic template rather than to the platform vendor (the
same rule the Athena gate applies), so the pricing page's "nothing leaves the machine" holds for this
path too. The model is whatever the seam resolves; the old `BRIEFING_NARRATIVE_MODEL` /
`ANTHROPIC_API_KEY` requirements are gone, so an Ollama-only install can use the feature. Metering is
the seam's (one `briefing`-lane row per call, BYOM priced `null`).

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
`practice.pr_opened`, `scan.regression`, `retention.purged`, and since 2026-09-05 `claim.released`.
`src/features/admin/audit/AuditLogViewer.tsx` is the searchable, paginated client viewer.

**The ledger has no delete door (2026-09-05).** The once-per-window claim markers the digest and
Athena crons write through `claimOrgAuditOnce` used to be hard-deleted by `releaseAuditClaim` when
the guarded dispatch failed: the only delete on `AuditLog` outside retention, and one that erased the
evidence that a dispatch was attempted. A release now appends a signed **`claim.released`** row
pointing at the claim it cancels, and a cancelled claim is not "live", so the next window retries
exactly as before. A failed dispatch therefore leaves two visible rows (the claim and its release)
where it used to leave none.

**Failed audit writes are counted and surfaced (2026-09-05).** Every audit write is best-effort by
design (losing a row must never fail the scan or mutation that produced it), but a dropped row used
to die in a server log. `src/lib/db/audit-health.ts` counts each failed write per process, and the
Audit tab renders a red **"Audit gap"** notice ("N audit writes have failed on this instance since
<UTC time>, the trail below has known gaps") above the table and above the empty state. The counter
is per instance and resets on restart; the notice says so.

## Membership, roles & invites

Org membership and role enforcement are wired end to end, backed by the `User` /
`Membership` models and enforced through `src/lib/authz.ts`:

- **Roles**: `owner` / `admin` / `member` / `viewer` (`OrgRole`, `src/lib/db/members.ts`),
  checked with `roleAtLeast`. `requireOrgRole(org, min)` gates owner/admin-only mutations
  (billing, member admin, destructive deletes); `requireOrgAccess`/`requireOrgRead` gate
  "any member" writes and reads respectively. Under the Supabase login wall
  (`authGateEnabled()`), the shared `viewerOrgRole` resolver seeds an owner only for an
  identity-verified viewer: their own personal namespace, or a GitHub-confirmed org admin
  via the App installation, never for the first stranger to touch an ownerless org. **Merely
  holding the GitHub App installation confers nothing** — that path went with the retired
  custom-OAuth stack, and `sessionOwnsOrg` no longer participates in any gate. Three docstrings
  and the Members tab's own footer copy still said otherwise until 2026-09-04.
- **An unreadable stored role resolves to the FLOOR** (`coerceStoredRole`, 2026-09-04). A role
  string the vocabulary does not know (DB corruption, a hand-run migration, a role renamed in a
  future release and read by an old deploy) becomes `viewer` and is logged, at all five sites that
  read one — including `acceptInvite`, which feeds the value straight into a persisted grant. It
  used to become `member`, which is not a floor: `member` clears `requireOrgAccess` (min `member`)
  and `canReadOrg` (min `viewer`), so a role nobody could parse conferred the right to act on the
  org. Absent (no membership row) is still `null` and is a different fact.
- **Slug canonicalization is a write-side rule too** (2026-09-04). `ensureOwnerMembership` is the
  only org-row *writer* in `members.ts` and took the caller's slug raw; on an upsert that does not
  miss the row, it creates a *second* tenant no read can reach. `/api/org/invites` likewise never
  canonicalized, so while `requireOrgRole` normalizes internally (the gate was safe), the raw
  casing reached the reads, the mutations and the `meta.org` of every invite audit row.
- **Invites**: `GET`/`POST`/`DELETE /api/org/invites` (owner-only, `src/app/api/org/invites/route.ts`)
  list, create, and revoke single-use invite tokens (role capped at `admin`; `owner` can
  only be conferred by promoting an existing member, not minted as a link). Acceptance is a
  same-origin, signed-in-only `POST /api/org/invites/accept` (`src/app/api/org/invites/accept/route.ts`),
  deliberately not a GET-on-render, since a GET would let link-prefetch/unfurlers burn the
  invite. `src/app/invite/[token]/page.tsx` is the UI that collects the token and fires the
  accept POST. All three transitions are recorded to the audit log —
  `org.member.invited` (create), `org.member.invite_accepted` (the grant) and
  `org.member.invite_revoked` (withdrawal, added 2026-09-06; the revoke row names the target,
  not just the invite id, and `revokeInvite` returns `{ revoked, target }` to supply it).
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
  owner's manual copy/paste path is never lost. The audit entry records the outcome, **and so does
  the UI** (2026-09-06): the Members tab renders the three real outcomes from one table keyed by the
  wire token — "Invitation emailed to X", "Nothing was sent … copy the link below and share it
  yourself" (no provider), and a `role="alert"` "Couldn't email X" — so an owner on a provider-less
  deploy is no longer shown a bare success and left waiting for mail that will not arrive. `null` is
  deliberately not rendered: a GitHub-login invite has no address, so there is no delivery to report.
- **The owner's pending-invite roster** (`src/features/admin/members/InviteList.tsx`, split out of
  `MemberInvites.tsx` under the 200-LOC cap) shows, per invite: the target, the role, **who sent it**
  (`invitedBy`, previously stored on every row and dropped on the way to the panel), the copy-link
  affordance only for invites minted in this session, and the expiry **as a countdown** —
  "expires in 3 days", the same sentence the invite mail sends, with the exact moment on the hover
  title (registry `software-engineering/status-vocabulary` → `timestamp-display`: relative by
  default, absolute one hover away). The roster has a real empty state, and revoking is a two-step
  `Revoke? → confirm / cancel`, matching the roster's Remove a row above — re-issuing mints a NEW
  token, so an accidental revoke costs a re-send rather than an undo.

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

Connects AI coding providers so the **AI delivery** views have a spend layer at all. One card per
provider from the registry (`src/lib/integrations/providers.ts`), each declaring the best
per-repo **fidelity** it can reach. **The connect surface is derived from the row, never from an id
(2026-09-05):** `status: "available"` + `connectKind: "otel-push"` renders the Claude Code OTel setup,
`"admin-pull"` renders `CopilotSetup` (a one-click owner **Sync now** against `POST
/api/integrations/copilot/sync`, with the route's denied / not-configured / absent / unreachable
branches rendered as remedies), and a `planned` row renders no surface. The status line under each
card is likewise keyed on the row: a seats-only provider reports **seats and peak engaged users**
and never a dollar figure, so a synced Copilot org can no longer read "$0.00 over the last 35
days". Before this the panel keyed on the literal `claude-code` id, so Copilot showed a green
"Available" badge with nothing to click while its finished sync route had no caller.

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
now a total `Record<Fidelity, ModelFidelity>` (`modelFidelityOfConnector`), so adding a connector
tier is a compile error until it is mapped. (A reverse table, `CONNECTOR_TIERS_BEHIND`, was removed
2026-09-05: nothing read it.) The delivery fidelity badge is keyed on `ModelFidelity` the same way,
so the `none` outcome renders as **"No cost source"**; it used to miss its lookup and print the
literal identifier `noCostSource spend`.

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

## The shared visual kit (`src/components/org/viz/`, 2026-09-08)

The org dashboard's long-standing habit was to *narrate* a reading and then show a table under it.
The [/org UX redesign](../../ORG-UX-REDESIGN.md) reverses that, and Wave 0 of it is this kit: one
dependency-free SVG vocabulary that every tab imports from `@/components/org/viz`, so five parallel
redesigns cannot each invent their own gauge, hatch or dash pattern.

**The epistemic state vocabulary (`states.ts`) is the load-bearing piece.** Six states, one
definition, imported everywhere — never re-declared in a feature directory:

| State | Encoding | The sentence it replaces |
| --- | --- | --- |
| `measured` | solid fill, full opacity | — |
| `declared` | no fill, dashed 1px outline (`DECLARED_DASH`) | "declared, not enforced" |
| `not-judged` | the shared 45°/2px hatch (`HATCH_ID`), **no value printed** | "not judged, never as passing" |
| `missing` | a void — nothing drawn, a gap in the lane, an empty cell | "an em dash is a missing measurement, not a zero" |
| `decided` | a 2px brand-accent ring around the mark | "the tier a scan derives is a measurement; admission is the decision" |
| `superseded` | 50% opacity plus a strikethrough rule | "supersedes rather than deletes" |

`STATE_LABEL` is the short label; `STATE_HINT` is the one-sentence caveat, and it is where the
demoted prose lands — it is the generated `<title>` on the shape, the legend row's tooltip, and the
body of a `WhyChip`. `rendersValue(state)` is the guard that stops `not-judged` and `missing` from
ever printing a numeral, which is the part prose could not enforce. `VizDefs` renders the one hatch
`<defs>`; nothing else in the repo may define a second one.

| Component | Shape | Built for |
| --- | --- | --- |
| `Legend` / `StateSwatch` | symbol-first legend, **only the states present in the data** | every panel that uses more than one state |
| `WhyChip` | keyboard-reachable ⓘ disclosure holding one caveat | the (D) Disclosed target for a demoted sentence |
| `Distribution` | min–q1–median–q3–max strip with a "you" marker | contributors, developer |
| `BandLadder` | nested bands + the edge that crosses without a declaration | governance stance, passport clearance |
| `BudgetPack` | used-vs-budget fill plus omission blocks grouped by reason | memory recall (it shows the losers) |
| `FlowRibbon` | 3-stage proportional ribbon; an absent stage breaks the ribbon | delivery unit economics |
| `StateTrack` | state-over-time lanes, change markers, unobserved intervals as voids | governance control ledger, adoption |
| `MatrixGrid` | declared × observed × enforced heat matrix | passports, practices, settings |
| `ConcentrationCurve` | Lorenz curve, gini area, marked bus-factor knee | contributors, teams |

Every component: `role="img"` with an `aria-label` and a `<title>` **generated from the same props
the geometry is** (the `ProvenanceTrack` discipline — the accessible text cannot drift from the
picture); an `sr-only` `<table>` equivalent; entrance-only motion gated on `usePrefersReducedMotion`
(`@/components/report/chartMotion`); `tabular-nums` figures and `Kicker`-voiced labels; and a
non-finite guard on every geometry input, so a NaN degrades to a labelled placeholder rather than a
silently broken path. Props are plain data — no fetching, no db imports, and no function props (the
charts are client components, so the caller passes pre-formatted tick labels rather than a
formatter). Colour comes from `LEVEL_HEX`/`scoreHex` and the CSS tokens; never a hand-picked hex.

### Contributors, redesigned: the distribution is plotted (Wave 1, 2026-09-08)

Contributors was the redesign's clearest case: **1473 characters of prose, five tables and zero SVG**
— a page about DISTRIBUTION rendered entirely as sorted lists. Every reading it offered ("this org's
knowledge sits in three people", "quartiles across everyone sharing", "a champion is high adoption
across real volume") was a shape stated as a sentence. `SectionHeader description=` in the directory
fell from **8 to 2**, and both survivors are unit/window only.

| Panel | Was | Is |
| --- | --- | --- |
| Tab opening | A 200-char lede paragraph | `Distribution` of AI-authored share per contributor, with the viewer's own position as the `you` marker (§5.2's pointer, drawn) |
| Concentration & bus factor | Six sorted columns under "High top-share or bus-factor 1 = key-person risk" | `ConcentrationCurve` — Lorenz sag, shaded Gini, the marked risk knee — with the per-repo table kept **below** it as auditable evidence |
| Org resilience | Two paragraphs describing bus-factor and the exposure blend | `Distribution` of the top contributor's commit share **per repo** over the whole fleet (not the top-8 list), then the tiles, then the risk table |
| AI champions | A ranked grid headed by the ranking rule | `ChampionScatter` — x is commit volume, y is AI share, dot radius is breadth, and the shaded band is the ≥50% "high adoption" bucket the producer already defines — with the ★ cards below as named evidence |
| Who to enable next | A paragraph stating the 90-day recency horizon | `BudgetPack`: the zero-AI pool is the budget, the list is what was packed, and the remainder is an omission block whose label carries the horizon |
| Care in this workspace | Five header paragraphs incl. two privacy promises | `CarePrivacyLedger` (a `MatrixGrid`) whose "Per-person row" axis is **void in every row**, and session shape as quartile strips |

Two things this fixed that were not cosmetic:

- **A void is not a zero, and the page could not tell you which it was.** `AiBar` took a plain
  `number`, so a contributor with no commits in the window, a repo with no attributed commit data,
  and a genuinely 0%-AI contributor all rendered the same empty meter. It now takes
  `number | null` and renders the `missing` state — the broken-rule swatch, an em dash and the
  caveat in a `title` — for anything non-finite. The call sites decide from the TYPED state
  (`topLoginState === "unknown"`, `commits > 0`), never by string-comparing a dash.
- **A privacy guarantee is stronger drawn than promised.** "Never who, and never a per-person row"
  was a sentence the reader had to trust. The ledger's right-hand column is void top to bottom, and
  the never-sent rows (transcripts, prompts/diffs, who kept what) are void on *both* axes; below the
  floor the counted column HATCHES (suppressed, no value printed) rather than going void, because the
  data exists and was withheld. Pinned in `CarePrivacyLedger.dom.test.tsx`.

Where prose stayed it moved rather than vanished: the tab's rationale is now the **empty state's**
argument (you only need "what this surface is for" when there is nothing to look at), the framing and
epistemic caveats are `WhyChip` disclosures, and the roadmap inventory that used to trail the panel is
this document's job. Quantile maths lives in the pure `contributorStats.ts` so the picture and its
`sr-only` table are demonstrably the same numbers.

### Governance, redesigned: the perimeter is drawn (Wave 1, 2026-09-08)

Governance was the redesign's worst offender: **2536 characters of explanatory prose and zero SVG
across 25 components** — a tab whose whole subject is *declared vs observed vs unreadable*, carrying
that distinction entirely in sentences the reader had to hold in their head while looking at a table
that did not show it. `SectionHeader description=` in the directory fell from **7 to 4**, and all
four survivors are unit/window only (`"worst first"`, `"counted once per repo"`, the resolved period
title, `"N scanned repos · 4 autonomy bands"`).

| Panel | Was | Is |
| --- | --- | --- |
| AI perimeter | A 304-char paragraph ending *"declared, not enforced"* over a text layout | `BandLadder` — four nested autonomy bands, each carrying its own state, with an arrow at the outer edge for what PR attribution shows crossing with no declaration behind it (`perimeterLadder.ts`) |
| Governance control ledger | A 300-char header fusing three jobs, plus *"a dash under State means the control was not readable"* | `StateTrack` lanes: gap = unobserved, hatch = unreadable, colour = the operating share (`controlLanes.ts`) |
| Admission column | *"The tier a scan DERIVES is a measurement. Admission is the decision."* | `BandLadder` of the three rungs; a rung somebody decided wears the `decided` accent ring, and each row carries its own `StateSwatch` (`admissionLadder.ts`) |
| Change-management evidence pack | A 207-char standfirst naming three things in a row | `FlowRibbon`: population → sampled → reviewed, drawn over the tab's own period and the export's own seed, so the headline and the artifact cannot disagree (`evidenceFlow.ts`) |
| Enforce in CI | *"The dashboard gate and your pipeline run the identical policy: no drift."* | Two marks: the server policy is `measured`, the parameters you paste are `declared` — which is what makes the tighten-only asymmetry legible instead of asserted |
| Sealed zones · unenforceable clauses · unassessed repos | Three rationale paragraphs | The `declared` dash, the `missing` void, and `WhyChip` disclosures carrying the sentences |

The band state is the whole argument compressed into one ternary (`bandState`, pinned by
`perimeterLadder.test.ts`): a tier the stance declares and repos actually sit in is `measured`; a
tier it declares that nothing has been read into is `declared` — dashed, no fill, *the perimeter
exists on paper only*; a tier the stance takes no position on is `not-judged`, hatched, with the kit
refusing to print a value beside it. `PerimeterBand` reads the **same** function, so the headline
ladder and the band detail below it cannot disagree about a tier.

Three things this fixed that were not cosmetic:

- **A dash could mean three different things and the page could not tell you which.** Unobserved,
  unreadable, and observed-and-failing all reached the reader as the same character. They are now a
  gap, a hatch, and a coloured bar.
- **An unassessed repository is a void, not a rung.** `viewState` returns `missing` for a repo with
  no passport and no decision: no admission row exists for it and the gate applies no bar, so the
  ladder carries it OUT past the outer boundary rather than painting it with the middle rung's
  colour. That was already true in the row copy; it is now true in the geometry.
- **The evidence pack's headline is the artifact's own numbers.** `evidenceFlow` draws the sample
  with the same seed and algorithm `/api/org/conformance-pack` uses, so the ribbon counts the rows
  the CSV would contain. Where the population cannot be read the ribbon draws three **voids** and
  says so — it never prints a zero for a measurement nobody made. The card owns that one read
  (`getAiChangePopulation` over the tab's resolved window), which is the deliberate cost of a
  headline that is true.

Where prose stayed it moved rather than vanished. The A3 rationale ("without a published stance the
fleet has one undifferentiated risk surface…") was already correctly placed — it renders only in
`StancePublishCta`, the empty state — and stays there. The UAT-mandated disclosures stay in **visible
text**, per this repo's own rule that a screenshot crops tooltips and keeps text: what a decision
writes (`NADIA-L1-09`) keeps its one-line claim with the three-artifact enumeration on a chip, and
the CI card keeps the ACTION ("re-copy the snippet after you relax the org bar") while the asymmetry
behind it becomes the `declared` mark's hint.

### Overview, redesigned (Wave 2, 2026-09-08)

Overview is the dashboard's **default landing surface** — the first thing anyone sees — and it opened
on a scope readout and a punch-list of sentences. Only two `SectionHeader description=` existed in the
directory, so almost none of this wave's gain came from deleting headers; it came from law clause 2
(*first sight is graphical*) and clause 4 (*encode the epistemic state, don't assert it*). The tab's
two-tier streaming architecture — one shared `resolveOrgScope` promise awaited in two `<Suspense>`
boundaries, no skeletons, nothing converted to `"use client"` — is untouched: this was a presentational
change on the reference implementation, and it stays the reference implementation.

| Panel | Was | Is |
| --- | --- | --- |
| **Fix first** | Three numbered sentences. Triage ORDER was visible; projected GAIN never was, so two candidates whose worth differs by a factor of sixty read identically. | A ranked bar chart on **one shared scale** — fleet-average maturity points — labels left, `FixFirstImpactBar` right, the way `MatrixGrid`/`StateTrack` lay a subject against its marks. |
| **Dimensions by SDLC phase** | A paragraph counting the debt (*"N of 9 dimensions still owe a follow-up (below 65)…"*) above a nine-row table. | `PhaseStandingStrip` — three lanes, one per SDLC phase, drawn against the green floor as a dashed rule. The count survives beside the section rule as a scope readout (a number, not a claim). |
| **Repo × dimension heatmap** | A 122-char lede; an absent measurement painted as a **red 0**. | Header reduced to `N repos × M dimensions`; an absent measurement is the kit's `missing` void. See the correctness fix below. |
| **Ledger row: window delta** | `—`, with "No baseline in this window" in a `title`. | The `missing` swatch — a dash in a column of numbers is the one glyph a reader reliably reads as *nothing changed*. |
| **Ledger row: unbacked average** | Grey text, *"no repos scored on this dimension"*, beside the number it prints anyway. | The `not-judged` hatch, with the words beside it naming the state rather than carrying it alone. |

#### The correctness fix: the landing page was fabricating scores

Every heatmap cell read `byId[d] ?? 0`. A repository whose latest scan never scored a dimension — a
legacy scan predating the dimension, an engine that returned a short dim list — was painted as a **red
zero**, announced to a screen reader as *"score 0"*, and given a click target that opened a detail
modal for a measurement that does not exist. The same component contradicted itself two rows down:
`columnAverages` has always EXCLUDED those repos from the fleet mean rather than dragging it toward
zero, and its own comment says so. One component, two answers, and the wrong one was the one in
40-point type on the org's front page.

This is the surface the *"structural zero is not a measurement"* doctrine (2026-08-31, above) already
governs; the heatmap simply predated it. An absent cell is now a `missing` void: framed so it is
locatable, empty so it is not a magnitude, **not a button** (there is no detail to open for a
measurement never taken), and carrying the shared caveat in its `title`. The fleet-average footer's em
dash became the same mark, so the body and the footer finally speak one vocabulary. Extracted as
`HeatVoid.tsx` precisely so the pair cannot drift apart again.

`RepoDimensionHeatmap.dom.test.tsx` seeds a repository with a missing dimension and pins all four
guarantees; re-introducing `?? 0` fails three of its cases (verified by seeding the old expression
back before committing — a matcher that stops matching reports a clean codebase in a voice
indistinguishable from success).

#### One unit, or a shared scale is a lie

`fixFirstImpact.ts` computes what each Fix-first bar is worth in **fleet-average maturity points**,
and the interesting part is the case where it refuses:

- a **regression** is a loss on ONE repo, so it is divided by `OrgMovers.comparedRepos` (repos with a
  real baseline on both sides) before it may sit on a fleet scale — a 9-point drop on one repo of 45
  is 0.2 fleet points, not 9. With no compared population the bar is a **void**, never an undivided 9;
- a **behind-pace goal** already names a fleet-wide target on a 0..100 metric, so `target − current` is
  the same unit by construction; the basis names *which* metric;
- a **findings queue has no scoring model at all.** The honest answer is `missing`, and
  `rendersValue("missing")` is false, so the bar cannot print a `0` beside it. This is the case the
  encoding exists for: a zero-length bar labelled "+0" would rank the product's most action-shaped
  queue last on a scale it was never measured on.

The bars introduce exactly one hazard — a reader assuming the numerals rank by bar length. They do
not, and deliberately: the numeral is triage precedence (a live regression outranks a queue awaiting a
decision outranks a slipping goal), because a candidate with **no bar at all** must not therefore sort
last. The numeral's own `title` says so, and `fixFirstImpact.test.ts` pins that ordering against the
case where the goal's bar is sixty times the regression's.

No new reads: `comparedRepos` and the goal's `target`/`current`/`metricLabel` were already on rows
`OverviewFixFirstPanel` fetches for the triage decision.

#### Prose ledger (E encoded · D disclosed · O empty state · F feature doc)

- **E** — *"N of 9 dimensions still owe a follow-up (below 65)"* → `PhaseStandingStrip`: three phase
  lanes against the green floor drawn as a dashed rule at `FOLLOW_UP_BELOW`. The count stays as a
  scope readout beside the rule.
- **E** — *"Every dimension is in the green band."* → every lane sitting right of the floor.
- **E** — *"Where each repo is strong or weak across all N dimensions"* → the heat grid itself, which
  is the sentence.
- **E** — *"Every repository grouped by `<mode>`: where each cohort stands and how it's moving"* → the
  Group toggle beside the header names the grouping; the cohort rows carry stand + movement.
- **E** — *"no repos scored on this dimension"* → the `not-judged` hatch on the ledger row.
- **E** — *"No baseline in this window"* → the `missing` swatch in the delta column.
- **D** — *"Each row names the practice that lifts it and the repos it touches."* Verified against the
  JSX before demoting: both affordances **already** carry exactly that in their own `title`
  attributes (`Open the practice that lifts <dim>…`, `Jump to the heatmap sorted weakest-first on
  <dim>`). The sentence was a duplicate of a disclosure that already shipped; deleted, not moved.
- **D** — *"Click a column to sort, a cell for its score, evaluation, and next steps."* Same check,
  same finding: the column button and the cell button each already say it in their `title`.
- **D** — the projected-gain basis (division by the compared population, the metric each goal's gap is
  measured on) → `WhyChip` on the Fix-first header, plus a per-bar `<title>` naming that bar's own
  arithmetic.
- **D** — *"the numerals are triage precedence, not bar order"* → `title` on the ordinal.
- **F** — the derivation contract for each Fix-first slot, and why a findings queue can carry no bar →
  this section.

**Stayed, and why** (law clause 1's escape): each Fix-first row's `detail` — *"regressed 9 pts vs its
last scan before this period"* — names the endpoints of a subtraction that a second cell on this same
page performs differently (the cohort card's row delta is first-to-last WITHIN the window). Two
identical labels over two different subtractions is worse than no label, and no encoding carries the
distinction between two baselines. It stays in visible text.

#### Kit components used

`FixFirstImpactBar` and `PhaseStandingStrip` are dependency-free SVG on `linScale` + `scoreHex` +
`stateFill`/`stateStroke`/`stateFillOpacity`/`stateStrokeWidth`/`rendersValue`/`isVoid`/`stateTitle`
+ `VizDefs`, following `MatrixGrid`'s discipline exactly: the track frame is **always** drawn so a
void is a locatable empty lane rather than a hole, the mark is drawn only when the state is not a
void, and the number prints only where `rendersValue` allows. `Legend` (3 call sites: Fix-first,
the phase strip, the heatmap) carries only the states present on screen. `StateSwatch` is the void /
hatch mark in four places. `WhyChip` (1). Nothing was re-implemented; there is no second hatch.

Both new drawings are **server-safe** (no hooks): the band and the ledger are direct children of the
tab's `stagger-children` wrapper, which already cascades them in, and a second entrance would
double-animate — the same rule `OverviewTab.tsx`'s header states about `.animate-arrive-in`.

New pure view-models with sibling tests, so the encodings are provable without a DOM:
`fixFirstImpact.ts` (15 cases) and `phaseStanding.ts` (8 cases); `OverviewFixFirst.dom.test.tsx`,
`PhaseStandingStrip.dom.test.tsx` and `RepoDimensionHeatmap.dom.test.tsx` pin that the drawings obey
the states. `OverviewScopeReadout` was reviewed and left alone: it is already two spans of metadata,
not a paragraph.

### Repositories, redesigned (Wave 2, 2026-09-08)

Standing › Repositories carried 849 characters of explanatory chrome, four tables and two SVGs, and
opened on a table header row. Wave 2 applied `docs/ORG-UX-REDESIGN.md` §2 to it: every panel now
opens on a shape, and each demoted sentence landed in an encoding, a disclosure, an empty state or
this document.

**The leaderboard is a distribution first.** `RepositoriesLeaderboardPanel` renders a fleet
`Distribution` (kit, `@/components/org/viz`) above the sorted table — the min/q1/median/q3/max of the
overall scores in the ACTIVE posture/stack scope, so the box and the rows can never describe
different fleets. The table is unchanged and is the drill-down evidence. Repos with no scan are
counted beside the box under the `not-judged` hatch; they never enter a quartile, and a fleet with
fewer than two scored repos draws the `missing` void rather than a zero-width box. The five numbers
come from `fleetShape.ts` (pure, unit-tested), so the plot and its `sr-only` table are the same
arithmetic.

**Foundation rollout is a matrix of three epistemic states, and two of them were being asserted
wrongly.** `foundationViz.ts` maps each repo onto `PR × Report-back × Conformance`:

| Cell | State | Why |
| --- | --- | --- |
| Ascent opened the foundation PR | `declared` | `foundation.pr_opened` records a **draft** PR (`src/lib/github/write.ts` sends `draft: true`). An unmerged draft is a claim about the fleet, not an observation of it. |
| No Ascent PR | `not-judged` | A team that hand-committed `.ai/` never passes through Ascent, so an empty cell here is unobserved — not "no foundation". |
| Report-back provisioned | `measured` | Ascent wrote those secrets itself. |
| Not provisioned | `missing` (void) | Not "off": the repo may still run `.ai/doctor.mjs` locally, unseen. |
| Conformance reported | `measured` + score | A genuine 0% keeps its numeral. |
| Never reported | `missing` (void) | An absence, never a zero — and `rendersValue` makes that structural rather than a caption. |

The panel's disabled bulk action now reads **"Foundation PR opened in every repo"** instead of
"Foundation installed everywhere", and each row reads **"PR opened"** instead of "Installed". The
CTA still says "install" (that is the intent, and `OnboardingFoundationPanel` says the same); only
the state claims were corrected.

**Context half-life is drawn as decay.** `FleetDecayScatter` plots every measured repo's potency
against the ≈commits that landed since its guidance was last edited, with the fleet's own **median**
decay curve through the cloud — the rate is recovered from the points themselves
(`contextDecayViz.ts`), never assumed, and no curve is drawn when no repo has decayed enough to
supply one. A dot under the dashed 50% rule is a context file that misleads an agent more often than
it helps. Repos that cannot be measured are counted under the plot with their own marks: freshness
unknown and scanned-before-the-signal are `not-judged`, no-guidance-file is a `missing` void. The
per-row ledger (`DecayRow`) carries the same marks, and the potency column is gated by
`rendersValue`, so an unjudged repo cannot print a number.

**Guidance coherence is drawn as a spread.** The card opens on a `Distribution` of the fleet's
coherence scores (`coherenceSpread.ts`) rather than on a mean: a fleet split between clean repos and
a handful of contradicting ones and a uniformly-middling fleet share the same average. The
denominator rule is unchanged — a repo with `coherence: null` (not assessed, or carrying no guidance
document) is excluded from the box and hatched beside it.

**Segments compare as paired rows on one axis.** `SegmentDumbbell` replaces the two columns of
figures and the two meters per dimension: A is the filled mark, B the hollow one, and the bar between
them is the delta. A segment with no scanned repo has no mark at all — `segmentViz.ts` maps the
`avgOverall: 0` sentinel to `null`, so it can be neither plotted nor printed, and the delta is
withheld rather than computed against a sentinel. The comparison is no longer suppressed when one
side is empty; the reader can now see which metrics exist on the other side. The maturity strip opens
on a `SegmentMaturityGrid` (`MatrixGrid` over segments × Overall/Adopt/Rigor) with the same hatch for
an unscanned slice; the cards below keep the per-segment scan and cadence controls.

`SectionHeader description` in the directory went from 6 sentences to 5 scope/unit fragments
(`"12/41 scanned · ~4-week activity"`, `"3/41 reporting back"`, `"12 assessed · 0–100 agreement"`,
`"12/41 assessed · ≈commits since edit"`, `"4 slices · 0–100, latest scans"`). Two were deleted
outright.

Everything above imports the shared kit; no state encoding, hatch, dash, legend or level colour is
re-implemented, and the new SVGs (`FleetDecayScatter`, `SegmentDumbbell`) paint only from `scoreHex`
and CSS tokens. Each is `role="img"` with a generated `<title>` and an `sr-only` table built from the
same numbers the geometry is.

### Adoption, redesigned: the spread is a curve (Wave 2, 2026-09-08)

Adoption was a **Tier-B** tab with the densest prose-per-component ratio on the dashboard: **483
characters of `SectionHeader description` across only seven components, and zero SVG**. The thing it
measures — how AI-native the org's engineering is — is a *distribution*, and it was rendered as four
tiles, three meters and a segmented bar, each captioned by the sentence that told you what the shape
below was about to say. `SectionHeader description=` in the directory fell from **4 to 1**, and the
survivor is 57 characters of window only.

| Panel | Was | Is |
| --- | --- | --- |
| Tab opening | A 213-char lede fusing a definition, a contents list, an adjacency claim and a CTA instruction, above a row of tiles | `AdoptionCurve` — the survival curve of personal AI share — as the first element, with the tiles beneath it as the quantities |
| Adoption spread | One segmented bar under "Every contributor, by how much of their own recent work is AI-attributed" | The same curve: three **measured** thresholds, a hatched `not-judged` envelope where the producer buckets rather than observes, and the org's commit-weighted share as a reference tick on the same axis |
| Team adoption | Eight `scoreHex` meters under "where AI habits live, and where they haven't spread yet" | `MatrixGrid` — AI commits × AI-active per CODEOWNERS team — where an unattributed team is **hatched and carries no numeral** |
| AI champions | A ranked meter list under "Culture carriers: high AI adoption across real volume…" | The same meters, with the naming-floor suppression and a genuine "nobody yet" now painted as **two different marks** |
| AI tooling in PRs | A chip band trailed by "detected via PR co-authorship / body markers" | The same chips, with the provenance caveat on a `WhyChip` |
| Delivery context | A strip captioned "shown beside adoption, not a causal claim" | The same strip; the reading constraint is a `WhyChip`, and the PR count is left as a bare unit |

**Adoption is a curve, and the honest curve is three points and a hole.** For a threshold *t*, the
curve is "what share of contributors carry at least *t*% AI-attributed work".
`getContributorInsights` buckets that at exactly three thresholds (0, ≥1, ≥50), so `AdoptionCurve`
draws three measured marks, a hatched `not-judged` envelope over each interval where the curve is
*bounded but not observed*, and **nothing at all** through the interior. A smooth line between the
buckets would assert a shape nobody read. The bounds are real: the curve is non-increasing, so
between ≥1% and ≥50% it provably lies between those two shares — and that is what the band is. The
tail envelope above the heavy edge is dropped when nobody is heavy, because a zero-height band draws
a hairline that reads as a measurement.

**There is no time axis on this tab, deliberately, and the redesign did not invent one.**
`buildAdoptionOverview` assembles latest-scan snapshots — `getContributorInsights`,
`getOrgPrSignals`, `getOrgTeamRollup` — none of which carries per-day history, and `RepoContributor`
is uniquely keyed `(repoId, login)` and upserted each scan (see "No per-contributor drill-down page,
deliberately"). Adoption-over-time would have had to be fabricated, so the curve runs over the
*population* axis instead. The one clause that survived into the header says exactly this, as a
window statement: **"Latest-scan snapshot · the period selector does not apply"** — the period picker
is cross-tab state, so a reader who chose "90 days" on Overview arrives with that selection still
showing and nothing here can honour it. Delete that line only along with the period picker.

**A team with nothing to measure is no longer a team measured at zero.** `rollupTeams`
(`src/lib/db/org-teams.ts`) computes `aiCommitShare = totCommits ? … : 0` and keeps any team with a
live-scored repo, so a team whose repos were scanned **without commit history** arrives as
`contributors: 0, aiContributors: 0, aiCommitShare: 0`. The old meter painted that with `scoreHex(0)`
— an alarm-red bar reading `0% · 0/0`, pixel-identical to a team measured at a genuine 0% across five
hundred commits. One is "we looked and nobody used AI"; the other is "there was nothing to take a
share **of**". `adoptionTeamMatrix.ts` splits them: `contributors === 0` → `not-judged`, which
`MatrixGrid` hatches and on which `rendersValue` refuses to print any numeral. The discriminator is
exact rather than heuristic — the team's commit totals are summed over the same people map, so no
contributor rows means no commits by construction. Pinned in `adoptionTeamMatrix.test.ts` (the two
identical `0%` payloads must render different states) and in `AdoptionViz.dom.test.tsx`.

The same split runs through the champions card: below `CHAMPION_MIN_POP` the producer **withholds**
the list, which is a suppression and now leads with the `not-judged` hatch; `champions.length === 0`
above the floor is a real reading and leads with the `missing` void. They used to be the same muted
line.

Prose moved rather than vanished. `adoptionHints.ts` holds every demoted sentence in one module — the
attribution provenance, the CODEOWNERS basis, what a champion is for, how tooling is detected, why
delivery sits beside adoption and not beneath it, why the curve is hatched between thresholds, and
why the commit denominator is dropped rather than printed as a zero below the naming floor — so the
tab's caveats are auditable as a list instead of scattered across seven files, and a caveat cannot
drift from the picture it qualifies. The CTA instruction ("copy the brief into Claude Code for an
enablement plan") moved onto the `CopyForLlm` button's own `title`, where it is an affordance. The
argument for the tab is now in the **empty state**, where the reader has nothing to look at.

Enablement targeting stays where the 2026-08-19 decision put it: the spread's "none" follow-up is
still the cross-tab deep link to Contributors, and this tab still never re-derives the cohort.

Curve geometry lives in the pure `adoptionCurveModel.ts`, so the SVG, its generated `<title>` and its
`sr-only` table are demonstrably the same numbers; `buildAdoptionCurve` refuses an empty or
incoherent population (buckets exceeding the headcount) and the chart degrades to a labelled
placeholder rather than plotting a NaN. Contributors the buckets do not claim are carried as
`unclassified` — an absence, never folded into the "none" bucket, which asserts a measured zero.

---

### One rule, four places it was not applied (Wave 2 postscript, 2026-09-08)

Wave 2's four correctness fixes are **one bug**, and this document already contained the rule that
governs it. [Mock scores never enter an average](#mock-scores-never-enter-an-average-2026-08-03)
states it for one kind of absence: a fleet with no live-scored repo renders `—`, "**Null, never 0**,
because a `0` in `scoreHex(0)` alarm-red reads as a catastrophic grade rather than 'not measured'."

That rule was written for *mock* rows and enforced there thoroughly — producer-side, with tests. It
was never generalised, so every other flavour of absence re-learned it the hard way:

| Where | The absence | What it rendered |
| --- | --- | --- |
| `AiBar` (Contributors, Wave 1) | contributor with no commits to take a share OF | identical to a measured 0% |
| `RepoDimensionHeatmap` (Overview) | dimension the latest scan never scored | red 0, announced "score 0", clickable into a modal for a measurement that does not exist |
| `rollupTeams` → `TeamAdoption` (Adoption) | team whose repos were scanned without commit history | alarm-red `0% · 0/0`, identical to a genuine 0% over 500 commits |
| `getOrgPractices` → `PracticeLedger` (Practices) | repos never assessed for a practice | dropped from the denominator silently: 2-of-41 drew the same full-width meter as 41-of-41 |

The common cause is not carelessness. It is that **the codebase had no way to say "unmeasured"**, so
every surface reached for the nearest available value, and `0` is always available. A rule stated in
prose is re-derivable but not enforceable; four teams re-derived it four ways and three got it wrong.

`states.ts` is that rule with a type behind it. `missing` and `not-judged` return
`rendersValue() === false`, so a void cell **cannot** print a numeral — a surface that wants to show
a zero there has to delete the guard on purpose, in a diff, where it is visible. The doctrine did not
change in this redesign; it acquired an implementation.

**Producer-level residue: none left in the mean.** Both producers named here when this section was
written on 2026-09-08 have since been fixed at the source — `rollupTeams` in `411a002e` and the
`roundedMean` root itself in `b1042324`. See
[The mean of nothing is null](#the-mean-of-nothing-is-null-the-generator-fixed-2026-09-08) below; what
remains open is narrower and recorded in Known gaps.



### Teams, redesigned (Wave 3, 2026-09-08)

The Teams tab was nine components, **zero SVG** and 548 characters of prose — a rollup grid that
described itself in a paragraph, a standings section whose header narrated its own box plot, and a
pairing list that asked the reader to perform a subtraction. It now opens each section on a shape,
and every absence on it carries a state from the shared kit rather than a glyph.

**Per-dimension averages are a matrix, not a numeric grid.** The dimension columns used to live
inside the sortable table: one tinted box per team per dimension, and a bare `·` wherever a team had
never been graded on one — distinguishable from a low score only by hovering it. `MatrixGrid`
(`src/components/org/viz`) draws the same data above the table and **hatches** the ungraded cell,
where `rendersValue` makes printing a numeral structurally impossible. The matrix follows the table's
sort, so the two are one surface; the table keeps what a table is right for
([§2.7](../../ORG-UX-REDESIGN.md)) — auditable row-level scalars with an expandable drill-down.
`teamsViz.ts` is the pure view model behind it (`dimMatrixRows`, `dimMatrixStates`,
`unjudgedCellCount`), so the picture and its generated `sr-only` table are provably the same numbers.

**The standings open on the spread.** The section header used to read *"platform leads at 78 and
mobile trails at 41, a 37-point spread across 6 teams. Each bar attributes the gap to a specific
dimension, measured against the fleet average of 60."* Every number in that sentence is a position on
a box plot, and the one thing it could not give is what a director opens the tab for: whether the
fleet is clustered with two outliers or spread evenly. `TeamsSpread` plots `Distribution` over the
team averages (`teamSpread`, R-7 quantiles, null below two teams — a point is not a spread), with the
extremes named as chart labels that deep-link to their rows.

What survived the demotion is the sentence's one genuinely load-bearing claim, which the prose had
buried: **the box and the factor bars are measured over different populations.** The box is the
spread of TEAM averages; the bars diverge from the fleet mean over *distinct live-scored repos*,
where a repo owned by three teams still votes once. That now rides a `WhyChip`
(`TWO_POPULATIONS_HINT`) on the spread itself.

**The affordances carry themselves.** The header instructed — *"Click a header to sort, a team to
open its repos and champions"* — because the only visible sign a column sorted was the `↓` that
appeared *after* it was clicked. Every sortable header now carries a dimmed `⇅` at rest (aria-hidden;
`aria-sort` and the button title are what a screen reader uses), and the row's disclosure control
says on itself what it opens. A sentence telling a reader a control exists is a control that does not
read as one.

**Pairings are drawn as gaps.** `platform 78 → mobile 41 · 37-pt gap` became `TeamsPairingGap`: a
0–100 track with both teams marked and the distance between them shaded. The positions say whether
this is a strong team pulling a weak one up or two mid teams a few points apart — which the arrow
glyph could not. The knowledge leader is a one-row `MatrixGrid` on the same axes the Adoption tab
plots teams with, so the two tabs read as one system.

**Unowned repos are `not-judged`, not "zero teams".** These repos were never *assessed* for team
ownership: the scan parses CODEOWNERS, and a repo with no such file (or one naming no team) yields no
attribution rather than a measured zero. The list carries a hatched swatch and its badge says "never
assessed for a team owner". The tab never printed a `0` here — unowned repos are kept out of the team
grid entirely — so this is an encoding fix, not a correctness one.

**Every absence in the matrix is now a mark.** A team with no commit population (see the closed gap
below) hatches its AI% cell; a period with no comparable scans draws the void instead of an em dash
in a column of numbers. Pinned by `TeamsViz.dom.test.tsx` alongside the existing
`TeamsHonesty.dom.test.tsx`, which was extended rather than replaced.

Two `SectionHeader description`s survive on the tab, both ≤60 characters of unit and window:
`"{n} attributed repos · Δ {window}"` and `"overall score · {n} teams"`.

Key files: `src/features/bought/teams/` — `teamsViz.ts` (pure view models), `TeamsSpread.tsx`,
`TeamsPairingGap.tsx`, `TeamsStandingColumn.tsx` (extracted so `TeamsStandings` could become the
orchestrator), plus the redesigned `TeamsMatrix`, `TeamsSignals`, `TeamsUnowned` and
`TeamsRollupPanel`.

---

### Tech Stacks, redesigned (Wave 3, 2026-09-08)

The Tech Stacks tab was the least broken surface in the redesign — 173 characters of prose and two
SVGs of its own — so Wave 3 converged it rather than rebuilding it. Everything the tab draws now
speaks the shared `/org` visual vocabulary (`src/components/org/viz`), and the tab's own dialect is
gone: the four diagnosis-class colours are the shared `LEVEL_HEX` ramp, the epistemic states are the
kit's, and the only remaining colour literal in the directory is `STACK_COLORS` — the categorical
identity ramp for the overlaid profiles, which deliberately avoids the score ramp so a red polygon
can never read as a bad score.

**First sight is the fleet's shape.** The tab opens on `StackSpreadStrip` — a `Distribution` over the
measured stacks' overall scores (min · q1 · median · q3 · max, with `n`) — above the profiles rail
and radar. The rail's sorted list of per-stack numbers is now drill-down evidence under a picture of
the spread, not the first thing on the page.

**The overlay radar encodes absence.** A stack that carries no average for a dimension — its scans
predate that dimension — leaves a **gap in the ring**: no vertex, no dot, and the profile is not
filled, because the enclosed area would be invented out of the missing axis. `radarShape()`
(`stackViz.ts`) produces one open run per contiguous stretch of measured axes; a complete profile is
still a single closed, filled polygon, so nothing about a fully-measured stack changed. The chart
carries `role="img"`, a generated `<title>` naming each profile's unmeasured dimensions, and an
sr-only table (`RadarSrTable`) whose cells print "No measurement" where the ring is broken.

**The rail states what it does not know.** A stack with no scanned repo renders the `not-judged`
hatch in place of a score, with the shared caveat as its title, and its second line reads
"N repos · never scanned" instead of a posture derived from zeroes. `rendersValue()` is the guard: a
hatched cell structurally cannot print a numeral.

**Legends are marks, not sentences.** The line under the consensus board that read
"hollow dot = laggard · filled dot = leader · vertical line = whole-fleet baseline · bar = spread" is
a kit `Legend` whose rows render the same elements the range track draws, each carrying its sentence
as a hover/focus hint. The profiles pane carries a second `Legend` listing only the states the
current selection actually contains — `measured`, plus `missing` when a plotted profile has a hole,
plus `not-judged` when an unscanned stack sits in the rail.

The consensus board's "How to read" disclosure (`SectionHelp`) predates the redesign and already
does what the law asks: it is the (D) affordance beside the heading rather than a preamble above the
rows. It stays.

### Settings tab — data erasure (Wave 3 of the /org UX redesign)

The erasure control is a **setup / destructive surface**, and `docs/ORG-UX-REDESIGN.md` §2.1 and
§4 both exempt those: a form that writes a credential, or an action that destroys data, should
explain itself before the user acts. So nothing instructional was stripped from it. In
particular these all stay, verbatim:

- `DataErasureCard`'s header — *"On-demand erasure for a data-subject or contract request:
  deletes this organization's scan history now, instead of waiting for the retention schedule.
  **Irreversible.**"* Wave 1's governance precedent: a screenshot crops tooltips but keeps text.
- The card's "what is erased / what is kept" paragraph and the typed-confirmation instruction.
- `DataErasureManifest`'s two enumerated columns, and the "watch flags and schedules survive, so
  a repo still on a cadence will begin building a new history" note.
- The audit opt-in's own label (redaction is a separate decision from erasing scan data).

**What changed: the blast-radius preview is now a picture as well as a count.**

`ErasePreviewPanel.tsx` (extracted from `DataErasurePreview.tsx` for the 200-LOC cap, view model
in the pure `erasePreviewViz.ts`) opens on a `MatrixGrid` from `@/components/org/viz` — five
rows × **Erased / Kept** — above the existing counts `dl`:

| | Erased | Kept |
| --- | --- | --- |
| Scan history | measured | *void* |
| Repo caches | measured | *void* |
| Audit trail | **depends on disposition** | **depends on disposition** |
| Your settings | *void* | measured |
| Org & members | *void* | measured |

The audit row is the only one that moves, and it is the reason the picture exists:

- `keep` — void in Erased, solid in Kept.
- `redact` — **solid in BOTH.** `includeAudit: true` resolves to `auditDisposition: "redact"`
  (`resolveAuditDisposition`, `src/lib/db/retention.ts`), which destroys the identities and keeps
  the account of what happened. The manifest needed three sentences and a doc comment to make
  that claim; a reader can see it in one glance and cannot mis-hold it.
- `delete` — solid in Erased, void in Kept. Drawn for honesty; the route answers a genuine
  `"delete"` with 409 unless the deployment sets `ERASE_AUDIT_FORCE=1`.

The four permanent voids in the Erased column are the guarantee drawn rather than promised
(Wave 1's contributors result): your organization, its repositories, its members and everything
you configured are never in that column, and there is nothing to paint there. `ERASE_MATRIX_HINT`
rides on a `WhyChip` beside the panel title and says what an empty cell means *here*.

**Nothing numeric is in the matrix.** The counts are quantities on their own units and stay in the
`dl` beside the picture, including the `at least …` FLOOR prefix when a preview stopped at its own
time budget. `MatrixGrid` paints a printed score on the red→green maturity ramp, and a row count on
that ramp would be meaningless. `erasePreviewViz.test.ts` fails if any cell is ever given a score.

Everything the preview already refused to do, it still refuses: a failed preview renders **unknown**
rather than zeros, and the confirm button stays disabled until a count has actually rendered.

**Also in this tab (owned by `docs/features/scanning/llm-providers.md`, cross-linked here):** a new
`ProviderBoundaryCard` is now the tab's first element — a `MatrixGrid` of Ascent / Bedrock /
OpenRouter × Boundary · Billing · Plan · Active, replacing the paragraph-per-provider comparison.

### The mean of nothing is null: the generator, fixed (2026-09-08)

The [Wave 2 postscript](#one-rule-four-places-it-was-not-applied-wave-2-postscript-2026-09-08)
named the defect class. Wave 3 found its **generator**, and this section records the fix
(`b1042324`).

There were **two functions named `roundedMean` in this codebase, with opposite contracts**:

| | Returns for an empty list | Its own docstring |
| --- | --- | --- |
| `src/components/launch/fleetMapDerive.ts` | `null` | "null when nothing is scored (never NaN/0)" |
| `src/lib/db/org-shared.ts` | `0` | "always empty-guarded, so copies that omitted the guard are corrected by routing through here" |

The second one's docstring described returning `0` as **the correction**. Someone consolidated
scattered mean calculations into a canonical helper and, in doing so, standardised the wrong answer
across 15 call sites — while the honest implementation sat in the launch surface, months old, and the
two were never reconciled. Every void-vs-zero bug the redesign found traces here or to a hand-rolled
copy of the old behaviour.

`mean` and `roundedMean` in `org-shared.ts` now return `number | null`. That produced exactly 33
type errors, **all of them in `src/lib` and none in a view** — which is the diagnosis: the producers
absorbed the sentinel and handed views a clean `number`, so the lie was manufactured at the bottom
and laundered on the way up. Each site was resolved one of two ways and never with `?? 0`: propagate
the null into the public type (`OrgRollup`, `OrgHeaderSummary`, `SegmentSummary`, `SegmentComparison.deltas`,
`percentileOf`), or narrow at the producer with a type predicate over the guard that already existed.
`hasFleetGrade()` is that predicate: the three averages share one population, so they are null together
or present together and a consumer that has checked one has checked all three.

**Two outputs changed, because the old ones were dishonest:**

- `SegmentComparisonView` drew a red `0` and a **fabricated posture chip** for an unscanned side —
  `postureFor(0, 0)` returns a real quadrant id, so a scope nobody had scanned was being
  *classified*. Now an em dash and "Not classified", with one-ended deltas withheld.
- `digest.ts`, `cron/digest`, `cron/athena` and `portfolio.ts` guarded on `scannedCount === 0` —
  **a guard an all-mock fleet passes**. Such a fleet was publishing `avg 0 · L1` into a Slack push,
  a board PDF, a portfolio row and Athena's standing: a fabricated failing grade leaving the product
  entirely. `hasFleetGrade` is strictly stronger and closes it.

Five view-side workarounds were **deleted** rather than kept — `realScoredCount === 0` /
`scannedCount === 0` re-derivations in `overviewStanding`, `stackMeasure`, `SegmentCard`,
`SegmentsComparePanel` and `segmentViz`, each of which existed because the view could not trust the
average it was handed and checked a different field instead.

**The two `roundedMean`s were deliberately NOT merged.** `org-shared.ts` imports `getPrisma`, and
`fleetMapDerive.ts` is client-side (the launch star map), so a shared import would drag Prisma into the
browser bundle — a break `tsc` and the unit suite both pass and only `next build` catches. Their shapes
also differ for a stated reason (streaming tally vs materialized array, so `orderConstellations` keeps
an unrounded sort key). They now agree on the **contract**, and each docstring names the other and says
why the boundary stands.

Pinned by `src/lib/db/mean-of-nothing.test.ts` (18 tests), which asserts every case as a **pair** —
empty → null, measured-zero → 0, and the two distinguishable. Re-introducing `Math.round(m ?? 0)` at
the root turns 21 tests red across 7 files, four of which predate this change.



## Key files

| File | Role |
| --- | --- |
| `src/components/org/viz/` | The shared visual kit (above): `states.ts` (the six-state vocabulary, `VizDefs`, `stateFill`/`stateStroke`), `Legend`/`StateSwatch`/`WhyChip`, and the seven charts. One `.dom.test.tsx` each. |
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
| `src/lib/org/briefing-narrative.ts` | Opt-in, number-grounded LLM narrative for the board PDF, with a deterministic template floor. Off unless `BRIEFING_NARRATIVE=1`; resolves the org's own model through `resolveTextRunnerForOrg` (2026-09-05). |
| `src/components/org/shell/OrgTabNav.tsx` | Persistent nav rail (two-level `SectionRailNav`), grouped by the transition journey. |
| `src/components/OrgSwitcher.tsx` | Org/installation picker (persists active org). |
| `src/features/standing/overview/Trajectory.tsx` | Forecast "GPS" card. Mounted by `/trends` (`TrajectoryPanel`), the personal overview and, since 2026-09-05, the org Overview ledger (`OverviewTrajectoryCard`, beside the standing strip, behind the same presentability gate the personal tier uses; renders nothing below it). |
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
| Headline **Org maturity** badge, adoption and rigor badges (`getOrgRollup.avgOverall/avgAdoption/avgRigor`), and the shell header chip, OG card and page description (`getOrgHeaderSummary`) | Since 2026-09-05 the **producer** excludes mock placeholders (both readers narrow identically, so one page cannot show two fleet averages) and carries `realScoredCount` + `mockCount`; the badge is titled with its denominator and shows an "N mock (excluded from avg)" chip; the cohort-matched period deltas, movement, dimension deltas and baseline exclude a mock endpoint on either side. A fleet with no live-scored repo renders "—" in the badge and the header chip, the fallback OG card and the generic description, never a 0/100. |
| Per-dimension fleet averages (`dimAverages`), the maturity **trend series** and the **forecast ETA** fit over it | Since 2026-09-05 (round 4) all three exclude mock rows at the producer, so the badge, the line under it and the ETA share one population. |
| `getOrgMovers` (Fix-first, digest, briefing, Athena) | Since 2026-09-05 both branches require a real-scored pair (`isRealPair`): a mock→live or live→mock engine transition is not repo movement in either direction. |
| `getOrgTeamRollup` team averages and movers; `explainTeamStandings.fleetAvgOverall` | Since 2026-09-05 team averages/dimension bars/posture exclude mock rows; an onboarded repo (no pre-window baseline) is segregated into `onboardedRepos` rather than folded into improving/declining, and `comparedRepos` counts only real period baselines; `realScoredCount`/`mockCount` ride on `TeamRollup` (not yet rendered). The standings "fleet average" is a mean over the DISTINCT live-scored repos any team owns (shared repos vote once), not a mean of team means. **2026-09-06:** the standings' **fleet AI share** — the baseline `aiShareDelta` renders as a coloured signed delta — got the same treatment. It was still `roundedMean(teams.map(t => t.aiCommitShare))`, 38 lines below the docstring condemning that shape, so a 10-commit team at 100% weighed the same as a 200-commit team at 5% and the team carrying almost all the fleet's commits read ~48 points "below the fleet". It is now commit-weighted over the same distinct-repo population, which required `TeamRepoScore` to carry per-repo human `commits`/`aiCommits` (percentages cannot be recombined). **Two populations, deliberately:** mock rows are excluded from the SCORE average (a floor is not a grade) and INCLUDED in the AI share, because `rollupTeams` merges a repo's contributors regardless of `mock` — so the per-team share counts them and the baseline must too. Pinned in `teamStandings.test.ts`. |
| Fleet masthead `avg`, per-group `avg` (`avgRealScore`) | Averaged over live-scored repos only. **Null, never 0**, when the set has none: the renderers land on the `—` no-score path, because a `0` in `scoreHex(0)` alarm-red reads as a catastrophic grade rather than "not measured". The repo *count* still describes the whole set, and the tooltip names the denominator (`N live-scored · M mock excluded`). |
| Fleet + per-group `avg move` (`avgRealMove`) | Excludes single-scan repos and **engine-transition** deltas, so a mock→live re-scan cannot fake improvement. Pre-existing; the score average now matches its precedent. |
| Corpus percentile (`getOrgBenchmark`) | Both sides filtered to non-`mock` engines at the current rubric version (see above). |

Groups with no live-scored repo sort **last**, not as the worst-scoring cohort. Pinned by
`src/features/standing/overview/fleetAverages.test.ts` (all-mock, mixed, and zero-scored fleets).

**Every period delta states its basis (2026-09-05).** The standing-strip arrows carry the window's
`comparisonLabel` ("vs 30d ago", "vs quarter start") as visible text plus screen-reader text and a
tooltip naming the cohort match; the Fix-first regression cell says "vs its last scan before this
period" and the cohort rows' net move is titled "first to last scan in this period", because the two
use different endpoints and both used to say only "this period".

**(Closed 2026-09-05, round 4.)** ~~`dimAverages` still folds mock dimension rows~~ — see the table rows above.

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
`get_ai_stance` MCP tool tells an agent exactly which clauses only it can honor, and since
2026-09-05 the stance perimeter renders the same list to the owner ("What this stance cannot
enforce", `UnenforceableClauses`, one derivation shared with MCP; nothing when the list is empty;
at org scope only the declaration-level clauses, since no repository has been read there).

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
  (`StancePerimeter` + `perimeterParts`): the `BandLadder` headline (2026-09-08 — see "Governance,
  redesigned" below), then the checkpoint strip (declared tools/models vs
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
- **A decision is withdrawable, and the withdrawal is an act** (since 2026-08-31; UAT `RC2-N4`).
  `DELETE /api/org/admission { org, repo, rationale }`, same owner + same-origin gate as the POST —
  unmaking a governance decision is the same authority as making one. The route used to expose GET and
  POST only, and `upsertRepoAdmission` can only *move* a decision, so the nearest thing to a revoke was
  granting the derived tier — which still records that an owner decided something. On a surface whose
  own argument is *"an override with no named author is not a decision"*, the inverse asymmetry was the
  defect: **a decision made in error was permanent**, and the ledger could not distinguish "decided,
  then withdrawn" from "decided". The pass that found it hit the wall while cleaning up after its own
  probe row, which could only be neutralised, not removed.

  **Two stores, two shapes.** The state row is **deleted** — an undecided repository has *no record at
  all*, and `getRepoAdmission`'s lazy seed re-creates the honest "seeded from the measurement, nobody
  has decided" state on the next read. A `withdrawn` status flip was rejected deliberately: it would
  leave a decision-shaped row every reader has to learn to discount. The withdrawal is **appended** to
  `OrgAudit` as `org.admission_withdrawn` (its own action value, not a second `org.admission` with
  different fields) carrying the actor, the mode and tier it removed, who had decided it, the derived
  tier and the reason — once the row is gone, the act is the only place the previous grant exists.
  Withdrawing an already-undecided repo is an idempotent no-op that writes **no** act: an append-only
  ledger carries what happened, not what was asked for. The UI affordance is a two-step **Withdraw** →
  **Confirm** on the perimeter's admission row, rendered only where a person actually decided
  (`decidedBy !== null`) — offering it on a seed would say the seed was a decision.
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
- **The column says which artifacts a decision writes** (since 2026-08-31; UAT `NADIA-L1-09`). It
  claimed a decision was *"recorded and enforceable"* and named none of the four, so a reader
  concluded all four had landed. One sentence under the intro now scopes it honestly: a decision
  writes the **gate-policy overlay** and only that — applied automatically on every gate call,
  tighten-only, failing closed if the admission read errors — while the CODEOWNERS block, the
  `controls.oversight` block and the branch ruleset are proposals a person opens deliberately.
- **The claim door consults the decision.** The MCP `claim_followups` gate resolves the *effective*
  tier from this row (grant beats derived where a tier was assessed) and refuses outright on a `mode`
  below `agents-allowed`. See [org-followups/README.md](../org-followups/README.md) → *Who may claim*.
- **UI**: `src/features/standing/governance/stance/admission/` — the admission column sits under the
  tier bands (the measurement it departs from), with an owner-only override that disables the tier
  select for an unassessed repo and shows the derived value beside the grant whenever they differ.
  Since 2026-09-05 the list endpoint returns **every tracked repository** with its derived tier
  (`deriveRepoAdmission`, computed in memory; a read writes nothing) overlaid with any stored decision,
  so the column offers the override before any row exists and the first override creates the row; a
  repo with neither passport nor decision reads "Not assessed" on a neutral rail. The empty-state
  sentence appears only when the org tracks no repositories.
- **MCP**: `get_ai_stance` takes an optional `repo` and returns that repository's compiled controls,
  admission mode and `unenforceable[]` list. Read-only, `mcp:read`, no new tool, and the `repo`
  argument is constrained to the caller's own org.

### Delivery, redesigned: the flow is drawn and the gaps are holes (Wave 1, 2026-09-08)

Delivery was **1184 characters of prose, six tables and three SVGs** — a page about FLOW and RATES
rendered as grids and caveats. `SectionHeader description=` in `src/features/bought/delivery/` fell
from **10 to 8**, and every survivor is ≤ 60 characters of unit/window only (`"Last 30 days · 12 scans · 41 repos ·
1 pt/day"`, `"5,120 PRs analyzed · 40 repos"`). Nothing was deleted; each sentence moved.

**The chains are ribbons now.** Unit economics ("what a unit of AI work costs: cost per session that
produced code, and cost per merged AI-attributed change") and AI delivery intelligence ("where AI
spend goes, what it produces, and whether that work gets reviewed") were both sentences describing a
three-stage flow, so both are `FlowRibbon`s: spend → produced code → merged AI, and spend → AI PRs →
reviewed. **When no connected provider reports cost the money stage is a `missing` VOID and the
ribbon BREAKS.** The integrations promise — "until a provider that reports cost is connected, the
money columns are empty rather than estimated" — is now a behaviour the drawing enforces rather than
a claim beside it, pinned by `ai/unitFlowStages.test.ts` and `ai/DeliveryFlows.dom.test.tsx`. A
zeroed stage would render a legible, proportional "we spent nothing" chain, which is a claim about
the org's spend rather than an admission that nothing measured it. The reviewed stage voids the same
way when no AI-PR sample cleared the floor.

**The em-dash caveat is gone because the picture no longer offers a zero.** *"An em dash is a missing
measurement, not a zero"* was the tab's most load-bearing sentence and the one prose could never
enforce. Every trend line now breaks at an unmeasured day (`trendPath` in
`deliveryTrendPanelMath.ts`), each panel counts its void days beside the delta, and the section
legend carries `STATE_HINT.missing` on the void swatch. `DeliveryVoids.dom.test.tsx` asserts the
negative that matters: two pen-downs, no `L` segment, no numeral at zero.

**Ordering became a shape.** *"Riskiest first: lowest review coverage, then slowest merges"* is
`ReviewCoverageStrip` — one column per repo, worst measured first, the below-target tail bracketed
with its count, and an unmeasured repo drawn as a dashed void rather than a zero-height bar. The
per-repo table keeps its place directly below it (§2.7: row-level auditable evidence), and the
denominator caveat it used to carry in the header is the `PRS_COLUMN_HINT`/`BASIS_HINT` `WhyChip`s.

**Governance gained a state it could not previously express.** `GovernanceGapMatrix` draws the
at-risk repos × four guardrails; a branch rule that requires a pull request with **zero** approving
reviews is `declared` — dashed outline, no fill — because it exists on paper and gates nothing. That
was a `title` attribute on a "0". `MatrixGrid` was deliberately not reused: its cells paint from a
0–100 score and print that numeral, and these four controls are boolean, so a score cell would invent
a percentage for a yes/no fact (`governanceGaps.test.ts`, `GovernanceGapMatrix.dom.test.tsx`).

**DORA reads as one instrument.** `DoraSmallMultiple` is four panels of identical geometry —
deploys/week, change-failure rate, time to next success, attribution coverage — with the two RATE
panels genuinely sharing the 0–100 axis and the other two carrying their own printed domain (one
numeric axis across per-week counts and hours would be the dual-axis mistake). A reading the
`MIN_DEPLOYMENTS` floor withholds is a void track with an em dash, so one bad deploy out of one has
no bar to be misread as a 100% failure rate. The AI-vs-human comparison is `FailureSplitMark`: two
bars on one axis with the point gap bracketed between their ends, replacing the accent callout
sentence; the "human-authored is a residual, contaminated in AI's favour" caveat rides its `WhyChip`,
reachable from the comparison rather than from a paragraph below it.

**Kit alignment, not a second dialect.** `DeliveryTrendPanel` and `DeliveryActivityChart` had their
own SVG before the kit existed; both now paint from `DEFAULT_BASE` / `--color-accent` instead of the
hand-written `#3b9eff`/`#7bbcff` (the same two values, read from the tokens), and the trend panel's
per-metric definition moved from a standing `<p>` into a `WhyChip`. `DeliverySlopeMark` gives the
gated fit readouts a shape: the true slope angle in a goodness-signed colour, and a **hatched** mark
with no numeral where `forecastInsufficiency` refuses to state one.

## Known gaps

- **One producer still emits `0` where it means "unmeasured"** (found 2026-09-08 by the /org
  redesign; see [One rule, four places it was not applied](#one-rule-four-places-it-was-not-applied-wave-2-postscript-2026-09-08)).
  ~~`rollupTeams` (`src/lib/db/org-teams.ts`) emits `aiCommitShare: 0` for a team with no contributor
  attribution instead of a nullable field, so **every** consumer must re-derive the distinction from
  `contributors === 0`.~~ **Closed 2026-09-08 (Wave 3):** `rollupTeams` emits
  `aiCommitShare: number | null` (and `knowledgeScore: number | null` with it), null meaning "no
  commit population to take a share of". Every consumer was fixed end-to-end in the same change —
  `teamStandings` (`aiShareDelta` nulls with it; the commit-weighted fleet baseline was already
  correct and is now pinned), the Teams matrix and standings (hatched `not-judged`, no numeral), the
  Adoption tab (`teamState` reads the producer's null instead of re-deriving from `contributors`),
  the Copy-for-LLM brief, and the CSV/JSON export (empty cell / `null`, never `0`). ~~What remains:
  `compareSegments` (`src/lib/db/segments.ts`) returns per-segment averages only, with an unscanned
  segment reducing to the `0` sentinel and no field distinguishing it.~~ **Also closed 2026-09-08
  (`b1042324`)**, along with the generator behind both: `SegmentSummary.avg*` and
  `SegmentComparison.deltas.*` are `number | null`, and `SegmentSummary.posture` is `string | null`
  because `postureFor(0, 0)` was handing an unscanned scope a real quadrant classification. See
  [The mean of nothing is null](#the-mean-of-nothing-is-null-the-generator-fixed-2026-09-08).
- **A segment comparison still draws two averages, not two distributions.** The narrower half of the
  gap above, and the only part still open: `summarizeSegment` computes per-repo scores internally but
  `compareSegments` returns only the mean, so the A/B view can honestly draw paired rows (a dumbbell)
  and cannot draw two boxes. Returning a five-number summary per side would turn `SegmentDumbbell`
  into a real distribution comparison. Not a drawing problem; a shared-query widening, deliberately
  left rather than done from inside a tab.
- **Two adjacent sentinels of the same shape, deliberately out of scope of `b1042324`.**
  `SegmentComparison.dimDeltas` still coalesces a dimension a scope is not scored on — that is
  per-dimension *coverage*, a different population from the mean of nothing, and its view-side guard
  (`value(scanned, v)` in `segmentViz.ts`) is correct today. `OrgBenchmark.corpusAvg*` still returns
  `0` beside `corpusRepos: 0`; honestly guarded at present, but the same shape of defect if the guard
  ever moves.
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
- **No DORA panel, deliberately** (partly overtaken since W4, wording corrected 2026-09-05): the scan
  now reads the GitHub Deployments API, and the Delivery outcomes card ships **deployment frequency**
  and a **change-failure rate** off that feed (`DeliveryOutcomes`), so the first two of the four are
  derivable for repos that deploy through GitHub Deployments; there is still no incident feed, so
  **time to restore** is not derivable at all, and the panels stay deliberately unlabelled as DORA.
  (Residual closed 2026-09-08 by the Delivery redesign: the trend section's on-screen note claiming
  no deployment feed is ingested is gone. Its replacement — `NAMING_HINT` in
  `DeliveryTrendLegend.tsx`, disclosed on the section's "not DORA" `WhyChip` — says accurately that
  deployment frequency and change-failure rate exist on the outcomes card and that only the incident
  feed behind time-to-restore is missing.) Original reasoning, still the
  policy for the label: of DORA's four metrics, Ascent ingests no incident feed, so **time to
  restore** is not derivable;
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
