# Marketing Site & Design System

UI primitives, the component deck, landing-page prototypes, and the two marketing
decks (`/about`, `/about-org`).

Context-map group: **Marketing Site & Design System** (`feature`).

> **Status: partially documented.** The deck reading scale and the `/about-org`
> deck are documented below; the primitive inventory is still only a pointer map.

## Implementation roots

The shared `Modal` moves focus inside after its portal mounts, preserving explicit
child autofocus such as confirmation dialogs' Cancel button. Tab and Shift+Tab stay
within the panel, including dialogs with no enabled controls; closing restores the
captured opener. These keyboard paths have DOM regression coverage, not a full
screen-reader or browser accessibility certification.
When dialogs overlap, only the top mounted layer handles Escape and Tab. A locked
confirmation also blocks Escape from reaching its parent. The body scroll lock lasts
until the final layer closes, including when a lower layer closes first.

`Defer` schedules a subtree's first appearance. Once shown, the same subtree stays
mounted when reduced-motion or immediate-render settings change, preserving local
input state. A newly mounted `Defer` instance still applies its own arrival policy.

| Surface | Route(s) | Source |
| --- | --- | --- |
| Design System: UI Primitives & Deck | — | `src/components/ui/**`, `src/components/deck/**`, `src/components/ConfirmAction.tsx` |
| Landing Page Prototypes | `/` | `src/components/landing/**` |
| Prism landing (preview beside `/`) | `/?landing=prism` | `src/components/landing/prism/**` |
| Marketing About Page | `/about` | `src/app/about`, `src/components/about/**` |
| Marketing Org Page | `/about-org` | `src/app/about-org`, `src/components/about-org/**` |

## The `/` landing deck ("The Index")

`IndexLanding` renders the production landing as a scroll-snap deck. Section
roster (also the right-edge `DeckNav`): **hero · org · fleet · local · gallery
(when the register has data) · pricing · levels · dimensions**, each a
`DeckSection` under `src/components/landing/prototypes/index/`.

**Org edition (`IndexOrg`, deck id `org`)**: six use-case cards into the curated
demo org. Copy names shipped tabs, not a retired Plan. The last card is
Follow-ups & Proposals (`orgTabHref(DEMO_ORG_SLUG, "proposals")`) — scan
follow-ups and loop proposals in one in-flight ledger, waiting on a decision —
never an ROI-ranked backlog and never `/org/{demo}/plan` (Plan tab retired
2026-08-17 in favour of that ledger; GOLDEN-TRIO: do not lead with ROI;
`getOrgBacklog` sorts by due/impact/recency and projected points are display-only).

**Fleet (`IndexFleet`, deck id `fleet`)**: the Mission Control constellation made
public. The picture is data-free `PublicConstellation` (deterministic phyllotaxis,
no fetch, no session, no fleet data). The three notes decode the metaphor — a
cluster per org, a star per repo, the sky as a glance at the estate — and never
claim the vignette is live-scanning. The stamp under the picture stays
`Illustrative fleet`. Sign-in copy points at the real Mission Control; the
picture itself is the metaphor.

**The register's counter is suppressed at zero** (`IndexGallery`). A count is a
claim, and zero is not one worth making: on a configured-but-empty database this
section headed "The register" used to open with "0 public repos rated", on a page
whose whole proposition is *now it has an index* (UAT `TOMAS-L1-05`). The
`Served live from …` provenance stamp stays in both states — the counter goes, the
honesty does not.

**An empty corpus is an ABSENT register, and that is the only behaviour.**
`loadPublicGalleryCards` returns `null` at zero cards, `IndexVariant` drops the
whole section, and nothing renders — no heading, no counter, no empty state.
`IndexGallery` used to *also* carry a worded `board.length === 0` state, which
could never fire (non-null implies at least one card implies a non-empty board),
so the register declared two behaviours for one state and shipped the other one
(UAT `RC2-N3`). The worded state is deleted; `scans-gallery.test.ts` pins the
zero-card `null` return, because if that goes the register needs it back.

**A row scored on an earlier ruler carries a `rubric rNN` chip, and the board says
so under itself.** `model.ts` states in writing that numbers from two rubric
versions are not comparable, and a rubric bump invalidates the gallery cache
*without* re-scanning anything — so an un-rescanned repo keeps its old score and is
ranked here against fresh ones (UAT `TOMAS-L1-11`). `PublicRepoCard` therefore
carries `rubricVersion` plus a derived `currentRubric` (`galleryCardFrom` in
`scans-read.ts`); a non-current row gets a violet `rubric r10` chip — or `rubric
unknown` when the scan predates the stamp, because unknown is never "the same
ruler" — and a mixed board prints *"Mixed rubrics on this page"* above the
growth-loop footer, counted over the rows actually rendered. This is the same
derivation, chip and wording MC-B18 gave `RegisterEntry` on `/leaderboard`
(`LeaderboardTable`): two public rankings over one corpus must not invent two
vocabularies for one fact. **Qualified, never de-ranked** — a stale score is a real
rating taken on an earlier instrument, unlike a mock score, which is not a rating
at all; dropping every pre-bump row would empty the register on the day of each
bump and publish something less true.

**The register footer links the capped landing board to `/leaderboard`.** The deck
gallery is a slice (`getPublicScanGallery` `recentLimit`/`topLimit`); the crawlable,
paginated ranking of the same corpus lives on `/leaderboard`. That path is a real
`next/link` in the register footer, not a heading that merely names the register.
The growth-loop scan CTA (`/?scan=1`) stays beside it.

The hero's scan dialog uses the shared `Modal` portal and its focus, Escape, backdrop,
and scroll behavior. The `?scan=1` deep link still opens the same scan form.

Two self-host surfaces added 2026-08-25, phrased in lockstep with `/pricing`'s
`SelfHostBand` so the copy can't drift apart in spirit:

- **Hero (`IndexHero`)**: an identity line under the lede ("Open source under
  AGPL-3.0 … The cloud plans buy operation, not capability") plus a co-primary
  "Open source · run it yourself" CTA beside the ScanModal button. It links to the
  deployment's repository (`NEXT_PUBLIC_SOURCE_REPO_URL`) when named, and falls
  back to `/pricing#self-host` — an anchor `SelfHostBand` now carries — instead of
  shipping a dead external link.
- **Local-loop section (`IndexLocal`, deck id `local`, after the fleet)**: three
  cards for the self-hosted-only capabilities — repo↔folder pairing with
  scan-from-disk (unpushed commits included), the autopilot loop (Claude CLI in an
  isolated worktree, branch as the deliverable, never pushes), and the read-only
  token-scoped MCP door. Card copy is verified against
  [`local-mode/README.md`](../local-mode/README.md) and `src/lib/mcp/tools.ts`;
  keep it exactly true when either changes.

- **Loop band (inside `IndexLocal`, added 2026-08-28)**: "Drive it to green" — the
  loop the product exists for (scan → propose → agent/foundation lane → rescan →
  drive to green), the one surface no marketing page named at all until now. Its
  rope is imported, not written: `LOOP_CONCURRENCY_CAP` and `LOOP_MAX_CYCLES_CAP`
  (`src/lib/db/loop-runs-types.ts`), `DRIVE_MAX_RUNS_CAP` (`src/lib/local/drive-types.ts`),
  and the three stop reasons typed against `DrivePhase` so a renamed phase fails the
  build here. The caps ARE the copy on purpose: the honest claim about this loop is
  that it is bounded and that a rescan, not the agent, decides whether anything
  landed — printing the numbers is what makes that checkable.

**Pricing (`IndexPricing`, deck id `pricing`, after the register when present)**:
a numeric, anonymous snap of the hosted plans (G8/G11). Amounts and cadences
come from `planPriceLabel()` / `PLAN_FEATURES` — never typed dollar literals. A
compact self-host band sits **above** the `HairlineGrid` and reuses
`IndexLocal`'s `/pricing#self-host` anchor. Free / Starter / Team are one-click
(`/` or `/onboarding`); Custom is `Flexible` plus `PlanEnquiryCta`. No "talk to
sales" on Starter/Team.

**Numbers in landing copy are imported, never typed.** The hero and
`DimensionMatrix` already read `LEVELS` / `DIMENSIONS`; `IndexPricing` reads
`planPriceLabel()`; the scan dialog's duration now reads `scanDurationClaim()`
(`src/components/report/scanEstimate.ts`), the same constants the live-scan
progress bar and its abort backstop run on. The dialog promised "in about a
minute" for a year — true of no provider the scanner has ever run on (~100 s
hosted, a measured ~6 min median on a local CLI), and already retired in
`ColdScanGate`'s copy while the hero went on printing it.

**The levels chart's dashed line marks a boundary that exists on its own axis.**
`TrajectoryChart` drew it at `POSTURE_THRESHOLD` (50) labelled "AI-NATIVE" and
`IndexLevels` invited the reader to "cross the dashed line and the org reads
AI-Native". Wrong twice: POSTURE_THRESHOLD is the cut on the **adoption** and
**rigor** axes (AI-Native means both clear 50, `model.ts:504-512`) while the chart's
Y axis is the weighted 0–100 index, and 50 on the index sits **inside L3** — so
crossing it changed neither level nor tagline. It now draws `AGENT_BAND`
(`prototypes/shared/levelRamp.ts`): the L4 floor, labelled with the level it is the
floor of, both read from `LEVELS`. `levelRamp.test.ts` pins that it stays a real band
floor and is not the posture threshold.

## The Prism landing (`/?landing=prism`, 2026-09-29)

The winner of the `landing-brand` contest (variant A/1, "Prism"), ported next to the
current deck and selected with `/?landing=prism`. **`/` is unchanged and remains the
default**; the current landing carries no link to Prism, and Prism links back to `/`
from its footer. `src/app/page.tsx` reads `searchParams` (a promise in this Next), wraps
the FAQ JSON-LD around either landing, and marks the Prism variant `noindex` through
`generateMetadata` until it replaces the default. Prism renders **without**
`SiteHeader`/`SiteFooter`: it has its own top bar (the new mark and wordmark) and a
foot carrying the legal links the app footer would have (Privacy, Terms).

**What it is.** One act as an identity: white light enters a prism shaped like the
letter A and leaves as nine lines, one per real dimension, each line's width being that
dimension's weight. A Solo / Team / Org switch reweights them live. Three layers, each
with a labelled way back: the page, a line's scene (`#/line/D3`), and one piece of
evidence (`#/line/D3/2`). The URL hash is the source of truth, so browser Back, deep
links, Esc, prev/next and `1`-`9` (from the top of the page) all walk the same layers.
The page ends with its own `#brand` sheet on paper: mark construction, drawn wordmark,
palette (Void, Graphite, Paper plus the Spectral Nine), type, the refraction motion
principle and the illustration style.

**What is real and what is drawn.** Levels, bands, dimension names and descriptions,
per-lens weights, posture labels and the rubric version are read from
`src/lib/maturity/model.ts` (`prismModel.ts`), never re-typed. Everything else is
**invented and labelled where it renders**: the evidence excerpts, readings (0-100) and
next steps (`prismEvidence.ts`, tagged `Illustrative`), the per-level "which lines burn"
plates and the drawn motifs (`Stylised`), and the sample badge (`Illustrative badge`).
None of it is a measured repository. The colour of a line always names a dimension.

**Wiring is the deployment's, not the prototype's.** The server page passes
`demoOrgHref()` for the org demo and `sourceRepoHref()` for the source link; with no
`NEXT_PUBLIC_SOURCE_REPO_URL` the source links fall back to `/pricing#self-host`
(the prototype's hard-coded GitHub URL is gone). "Scan a repository" is a link
whose `href` is the deep link `/?landing=prism&scan=1` (it works before hydration and in a
new tab) and whose plain click presses the **real `ScanModal`'s own trigger** (mounted
hidden), so the sign-in wall, quota meter and consent flow are the current landing's and
Escape closes it at once. Going through the URL instead would make Escape wait for a
server render, because the deep link only closes once the page re-renders without
`scan=1`. `PRISM_SCAN_HREF` in `prismLinks.ts` is the one place to change when Prism replaces `/`.

**Motion.** The intro (2.7 s) is skippable by the button or any key, wheel or touch, and
hands over by itself; labels appear from 72 % of it. `prefers-reduced-motion` starts
already handed over, draws one still frame per layout, drops the SMIL motion paths from
the line art and shortens the swap beats (the stylesheet also zeroes CSS
animation/transition durations). The canvas pauses while a scene covers it, while the
hero is off screen and while the tab is hidden.

**Files** (`src/components/landing/prism/`):
`PrismLanding.tsx` orchestrates; `engine/` is the canvas (`geometry.ts` pure layout,
`glow.ts`, `light.ts`, `draw.ts`, `engine.ts`); `usePrismHero.ts` binds it to React;
`useScene.ts` + `PrismScene*.tsx` are the nested layers; `PrismHero`, `PrismLadder`,
`PrismMethod` (`PrismBench`, `PrismPosture`), `PrismBeyond`, `PrismBrand*`, `PrismLaunch`
are the sections; `prism.css` is the winner's stylesheet scoped under `.prism-root`
(custom properties, keyframes and svg ids are `prism-` prefixed; the root is an isolated
stacking context so the app's modal host sits above it). Symbol ids `prism-mk` /
`prism-wm` are the mark and wordmark.

**Held to the winner by measurement, not by eye.** The port was checked against the
winner's computed styles with `style-contract.py` (48 page roles at 1440x900, 1920x1080
and 390x844, 20 scene roles, 8 evidence roles). The only deviations are 0.7 % `max-width`
and 5 px padding differences that come from the app's `scrollbar-gutter: stable`
narrowing the hero box by the scrollbar (the winner's file page had none); they are left
as they are rather than absorbed by widening a tolerance. Every interaction above is
driven in a browser (80 checks, 80 passing) and the pure parts, the server markup, the scene and the
ladder are pinned by vitest under `src/components/landing/prism/`.

**Known gaps.**
- The hero canvas and the scene are browser-only: there is no server-rendered picture,
  so a visitor without script gets the headline, the nine labels and the sections but an
  empty prism.
- The fonts are the prototype's system stacks (Segoe UI / SF Pro, Cascadia / SF Mono),
  not the app's Geist; the identity is specified that way and no webfont ships.
- The page's favicon and the app-wide header/OG images still show the current mark; the
  new identity is applied to this landing only.
- Not yet measured on real assistive technology: focus order and the modal scene are
  covered by DOM tests and a scripted drive, not a screen-reader pass.

## The app type scale (`type-*`)

Since 2026-08-30 every font size in the app comes from one scale in `src/app/globals.css`: the
Tailwind size tokens are re-based **+1px** over the framework defaults (xs 13px, sm 15px, base 17px,
lg 19px, xl 21px, 2xl 25px, …) and fourteen semantic `@utility type-*` classes name the voice —
`type-label` (mono uppercase eyebrow), `type-caption` / `type-note` (13px metadata),
`type-body-sm` / `type-mono-sm` (15px), `type-body` (17px), `type-lede`, `type-title`,
`type-heading`, `type-figure` / `type-figure-lg` (mono tabular stats), `type-display` /
`type-display-lg`, and `type-micro` (12px, the floor). A repo-wide sweep replaced ~470 files of
raw `text-xs…text-4xl` and `text-[10px]`-style sizes; `text-5xl`/`text-6xl` remain raw on the
hero/kiosk surfaces. The table in `src/components/ui/BRAND.md` is the reference; `type-label`
deliberately sets no letter-spacing (Tailwind v4 emits `tracking-*` before multi-declaration
custom utilities, so a fixed tracking would beat the explicit one on the element).

## Design-tokens study (`AppearanceStudy`)

The surface-library design-tokens study (`src/features/shared/surfaces/AppearanceStudy.tsx`)
renders the live token table — **accent, ink, surface, divider, danger, warn, success**,
and `LEVEL_HEX` from `@/lib/ui` — not a picker of Ascent / Mint / Amber appearances.
[BRAND.md](../../../src/components/ui/BRAND.md) is one azure on cold ink. Mint and amber
are not peer accents; `warn` / `success` are status, and `LEVEL_HEX` is the score ramp only.

## Data-viz study (`DataCharts`)

The surface-library data-viz study (`src/features/shared/surfaces/DataCharts.tsx`)
renders the org viz kit — `Distribution` and `BandLadder` from `@/components/org/viz`,
with `STATE_LABEL` and `scoreHex` (`@/lib/ui`) — not CSS `<i>` bars of hardcoded
readiness. Scores in the playground are labelled as a study series, not live org
or marketing figures. Empty level bands stay `missing` (`STATE_LABEL.missing`,
"No measurement"), never a zero.

## Async UI states study (`FeedbackPlayground`)

The surface-library async-ui-states study (`src/features/shared/surfaces/FeedbackPlayground.tsx`)
is driven from `Defer` (`@/components/ui/Defer`) and `VIZ_STATES` / `STATE_LABEL`
(`@/components/org/viz`). It is not invented Ready / Loading / Empty / Error, and it
does not teach a spinner or skeleton as the house async contract. `Defer` schedules a
subtree's first appearance (strategies `next-frame`, `idle`, `visible`); once shown,
the subtree stays mounted. That is not a loading state: children are ready, and the
placeholder is a quiet gap (`.reveal-quiet`), never a fake page. Epistemic marks use
the six `VIZ_STATES`; `missing` stays `STATE_LABEL.missing` ("No measurement"), never
a zero.

## The deck reading scale (large-screen typography & measure)

Marketing decks used to stop growing at `lg`: the container was pinned at
`max-w-6xl` (72rem) and every type size sat at its `sm:` step, so a 2560px display
rendered the same 1152px column of 16px body copy as a 1280px laptop: the reading
distance grew, the page did not.

`globals.css` now defines a fluid ramp that components opt into by class:

| Class | Floor (at `lg`) | Ceiling | Used by |
| --- | --- | --- | --- |
| `.deck-h1` | `--h1-floor`, default 3.75rem (`text-6xl`) | `--h1-ceil`, default 5.25rem | masthead headlines |
| `.deck-h2` | 1.875rem (`sm:text-3xl`) | 2.75rem | section titles (`SectionHeading size="page"`) |
| `.deck-lede` | 1.125rem (`text-lg`) | 1.375rem | intro paragraphs |
| `.deck-body` | 1rem (`text-base`) | 1.1875rem | body copy, card blurbs |
| `.deck-figure` | 1.5rem (`text-2xl`) | 2.125rem | mono stat-ledger figures |
| `.deck-container` | 72rem / `px-5` | 92rem / 2.75rem padding | replaces `mx-auto w-full max-w-6xl px-5` |

Rules that make this safe to extend:

- **Everything is inside `@media (min-width: 64rem)`.** Below `lg` nothing changes;
  each floor equals exactly what the element rendered at 1024px before.
- **Ramps are written as `clamp(FLOOR, FLOOR + (100vw - 64rem) * rate, CEILING)`.**
  Writing the growth as a delta from the floor makes the breakpoint continuous for
  *any* floor, which is what lets one `.deck-h1` rule serve both mastheads via the
  `--h1-floor` / `--h1-ceil` custom properties (`[--h1-floor:3rem]` etc.).
- **Unlayered rules beat Tailwind utilities.** Tailwind v4 emits utilities into the
  `utilities` cascade layer, so `class="text-4xl sm:text-6xl deck-h1"` keeps the
  small-screen steps and takes the ramp from `globals.css`. Restate `line-height`
  in any new ramp; the utility's own line-height survives otherwise.
- **No root `font-size` trick.** It was tried; `html.snap-deck` is added in an
  effect *after* mount, so every large screen visibly re-typeset itself once
  hydration landed.
- **Vertical rhythm in a `min-h-screen` hero keys off viewport HEIGHT, not width**
  (`[@media(min-height:60rem)]:mt-16`). A hero fills a 1080p viewport almost
  exactly, so adding air at a `2xl` *width* breakpoint pushes the stat ledger under
  the fold, where `overflow-hidden` silently clips it.

## Scroll & canvas

- **`DeckProgress`** (`src/components/deck/DeckProgress.tsx`): a 2px accent rule at
  the top of the viewport that fills as the deck is descended. Pure CSS via
  `animation-timeline: scroll(root block)` behind an `@supports` guard: no scroll
  listener, no rAF, no per-frame React work. Rendered by all three deck
  orchestrators.
- **`DeckNav`** (`src/components/deck/DeckNav.tsx`): labelled `#id` anchors for every
  deck section. Desktop is a right-edge rail; below `lg` the same `sections` array
  feeds a bottom bar with prev/next plus a native `<details>` jump list so a phone
  reader can open any mid-deck chapter (Pricing, ROI, CTA) without paging through
  every snap. Progress pills stay visual-only (`aria-hidden`).
- **The canvas wash moved off `body`'s own background** into a fixed `body::before`.
  `background-attachment: fixed` forced a main-thread repaint of a 70rem radial
  gradient on every scroll frame and blocked compositor promotion.
- **`html.snap-deck body::after`** paints a ~3% fractal-noise paper grain (fixed,
  180px tile). Scoped to the marketing decks: the org dashboard is a dense data
  surface where even 3% noise is texture the reader has to look past.
- **`html { scrollbar-gutter: stable }`** stops the sideways reflow when a modal
  locks scroll; **`html.snap-deck { overscroll-behavior-y: none }`** stops the
  rubber-band at both ends of a deck fighting the snap.
- **`.tick-corners`**: four hairline registration marks drawn as eight 1px
  background slivers, so it can sit on any panel without an extra element. Claims
  only `background-image`, so a panel's `bg-surface/40` is untouched.

## `/about`: invented data is labelled where it renders

**The masthead does not lead with ROI.** GOLDEN-TRIO: do not lead with ROI. `AboutHero`
INTRO and the page `metadata.description` name the score, the maturity ladder, and the
evidence — the same three ingredients as `siteDescription()` in `lib/site.ts` — never
"the highest-ROI path". Counts are derived from the model. The ROI simulator stays later
on the deck, labelled illustrative.

The marketing deck's four diagrams (`FleetGrid`, `RoiSimulator`, `ChampionNetwork`,
`RiskRadar`) are demonstrations, not customer results. The **ROI simulator** is the
one a prospective buyer reads as proof — it computes over eight invented repos at a
`W = 0.16` weighting its own source calls "deliberately NOT the production
weighting" — and until 2026-08-31 both facts lived only in comments, i.e. only for
people reading the repository (UAT `MC-B6` / `TOMAS-L1-04`, recurrence 2). The other
three diagrams were the same omission: invented cells, contributors and alerts,
labelled only in source.

**The rule: a provenance caveat renders, or it does not exist.** Every invented
diagram on `/about` now closes with the same `type-label tracking-[0.22em]
text-slate-600` chrome `AboutOrgHero` ("Illustrative fleet · 48 repos") and
`AboutOrgLoop` ("Illustrative cycle") already use — so the disclosure is one
recognizable house form across both decks rather than a per-diagram phrasing.
`RoiSimulator` still names the sample-repo count from `REPOS.length` and the demo
weighting; `FleetGrid` names `REPOS.length`; `ChampionNetwork` names the sample
contributor count from `NODES`; `RiskRadar` names the sample alert count from
`BLIPS`. Counts come from the arrays they render, so editing a vignette cannot
leave the caption lying. `RoiSimulator.dom.test.tsx` and `FleetGrid.dom.test.tsx`
pin the rendered labels.

The simulator was kept rather than deleted in favour of the landing register of real
scanned repos: the register is server-fetched on `/` (and absent entirely when no DB
is configured), while this deck is a client orchestrator whose `roi` section copy in
`features.ts` describes the what-if simulator specifically. Promoting the register
here is a structural move, not a caption fix — and a labelled demo beside a real
register elsewhere is honest, whereas an unlabelled one is not.

The paired `roi` money line in `features.ts` names those same live tiles
(promotions, average gain, repos in scope). It must not carry a dated N-of-M
forecast the sliders never compute (no calendar quarter, no "6 of 8" count).
GOLDEN-TRIO: do not lead with ROI. `features.test.ts` pins the contract.

**The transition pane does not sell settable goals or forecast ETAs as climb
controls.** `AboutTransition`'s intro names the `LEVELS`-derived ladder and the
measurable path between rungs. The Plan tab that hosted visitor-settable goals
retired 2026-08-17; goals are read-only, and `etaDays` prints on the Briefing PDF
(`src/lib/pdf/briefing-document.tsx`), not as a control the visitor operates on
this deck. `AboutTransition.test.ts` pins that zero intro clauses restore the old
"goals and forecast ETAs so the climb stays on pace" pitch.

## `/about-org`: the organization edition deck

Seven snap sections: masthead · the five questions · three feature deep-dives
(practices, memory & skills, governance) · the operating loop · CTA. It shares
`DeckSection` / `DeckNav` / `Reveal` / `AboutFeature` / `AboutCtaButtons` /
`GlowBackdrop` with `/about` rather than forking them.

**The module map section was removed (2026-08-29).** It rendered the org rail's six
groups as a tablist of 21 view cards. The headline figures it fed survive —
`src/components/about-org/orgModules.ts` is now just `MODULE_COUNT` / `VIEW_COUNT`
derived from `ORG_NAV_GROUPS` (`src/lib/org/orgTabs.ts`), the same constant the
shipping rail renders, so the masthead ledger and the page's `<title>` /
description / FAQ payload still cannot contradict the product; `orgModules.test.ts`
pins that derivation. The per-view blurb table went with the section rather than
lingering as prose nothing renders.

**And so is every module NAME the deck prints.** `AboutOrgQuestions` (the "you are
here" trail beside each question), `AboutOrgLoop` (the module under each step) and
`orgFeatures.ts` (each feature pane's kicker) all resolve their module label
through `orgGroupLabelFor(tab)` rather than typing one. Hand-typed, they named
**Fleet, Intelligence, Govern, Plan and Library** — an information architecture the
regroup retired — on the very page whose module map promises "same modules, same
order, same names". `orgModules.test.ts` pins that every printed module name is one
the rail has, and that a non-rail tab yields `null` rather than a wrong trail.

**Every diagram states a real constraint.** `PracticeCascade` caps its run at the
same 25 repos/call `POST /api/practices/apply-batch` enforces; `KnowledgeLedger`
renders `MEMORY_KIND_LABEL` and `usageVerdictLabel` / `DORMANCY_WINDOW_DAYS` from
the product's own modules rather than invented vocabulary.

**And every invented number is labelled where it renders.** The practice fan, the
recall list and the governance sheet are demonstrations: a sample fleet, sample
memories, sample pass counts and a sample trail. They close with the same
`Illustrative · …, not customer data` chrome as `/about`, counting from `FLEET` /
`RECALL.length` so the caption cannot outlive the vignette. The real constraints
above stay in the picture; the stamp is what stops a visitor reading those
constraints as a customer result. `FleetGrid.dom.test.tsx` pins the three stamps.

**The loop section borrows the live theater's vocabulary, not a metaphor for it.**
It is the cockpit's `LaneRail` shape (`src/features/inflight/live/cockpit/`): one
rail with a stop per loop verb and repositories distributed around it, each
mid-glide, with live occupancy per stop and the cycle's net lift in `fmtDelta`. The
five steps live in one shared catalog (`loopSteps.ts`) with the return edge as a
named index, so nothing can point the arrow at a different stop. The stop head, the
lane rails and the drawn return arc all read positions from one `stopPct` over a
fixed five-column grid, and the head shares the lanes' horizontal padding — which is
what lets the arc be *drawn* at every breakpoint instead of stated in words, the
objection the earlier card-row version raised against drawing it.

The section runs on `aboutOrgLoopMotion.ts`: one shot, armed in view, replayable,
with prefers-reduced-motion short-circuited to the END state rather than to a
skipped animation — the same contract as the observatory's `useDriftProgress`.
Nothing on the deck animates on a timer.

## Form controls (`src/components/ui/Field.tsx`)

**This standard did not exist before 2026-08-14.** A survey found ~50 hand-rolled
inputs on `border-slate-700 bg-slate-900 …`, the exact literal
[BRAND.md](../../../src/components/ui/BRAND.md) tells you not to write, in four
padding variants, plus a `FIELD_LABEL` mono-label constant copy-pasted per modal.
Every dialog therefore looked slightly different from every other one, and none of
them looked like `/` or `/about`, which do use the brand tokens.

| Export | What it is |
| --- | --- |
| `Field` | A labelled row: `Kicker tone="muted"` eyebrow, an optional hint, the control, then an error when there is one. The hint sits **above** the control and the error **below** it, because they are read at different moments: a hint is an instruction you want before you start typing (under a group of checkboxes it arrives after you have already answered), an error is feedback you look for where you just acted. `as="fieldset"` renders a real `<fieldset>`/`<legend>` for a control group. |
| `TextInput` / `TextArea` / `SelectInput` | Thin wrappers over the shared skin. |
| `CheckCard` | A checkbox drawn as a **selectable bordered tile** with a title + supporting line, tinting to the accent when picked. The native input stays in the DOM (`sr-only`) and drives the visual box through `peer`, so keyboard operation, form semantics and AT announcement are unchanged and the focus ring lands on the drawn box. |
| `CONTROL_CLASS` | The skin itself, for a one-off control the wrappers don't fit, so it lands on the same tokens instead of inventing a fifth variant. |

The field error is deliberately **not** a live region. A form that marks the offending field and
also announces the same failure from its footer fires two announcements for one error, so the
caller's summary is the announcement and the per-field marker is the visual "which control".

Labels associate **implicitly** (the control is wrapped by its `<label>`), matching
what the existing modals already did: no id plumbing at the call site and no chance
of a mismatched `htmlFor`.

`Kicker` gained an `as` prop (`div` | `span` | `legend`) for this: a Kicker used as
a form label sits inside a `<label>` (phrasing content only, so a `div` there is
invalid HTML) or as a fieldset's `<legend>`. Purely structural; the type treatment
is identical.

Adopted by `PlanEnquiryFields` (the `/pricing` Custom-plan dialog) and
`CreateIssueModal`, the file the kit was extracted from, migrated in the same
change so the standard didn't ship with exactly one user. `ConfirmAction` skins its
Cancel control with `CONTROL_CLASS` rather than a hand-rolled `border-slate-700`
outline, so a one-off dialog button lands on the same tokens as Field. The remaining
hand-rolled inputs are unmigrated; move them as you touch them.

## `InfoTip` (`src/components/ui/InfoTip.tsx`, 2026-09-17)

A small circled **i** beside a label that opens a one-paragraph explanation on click.

**What it is for.** Several control surfaces carry a standing explanation under the control — what
the loop's verification dial executes, what a lane brief is assembled from, what "land in my current
branch" does to a working copy. Each paragraph is true and worth having; rendered inline, five of them
turn a setup panel into an essay whose controls you have to hunt for (the Live tab's run dials were
exactly that before they became `RunSetupModal`). The sentence keeps its place in the product and
loses its place on the page.

**What it is not for.** Never the alarm. A consequence the operator must read *before* they act — a
mode that writes into their checkout, a guard they have just switched off — stays on the page as a
visible line. Use `InfoTip` for the explanation, never for the warning.

**Why a button and not `title`.** The native attribute is invisible to touch, unreadable to most
screen readers as prose, and unstyleable. This is a real toggle: `aria-expanded`, a keyboard-reachable
trigger, Escape and blur to dismiss (a click inside the panel keeps it open — `relatedTarget` is
checked against the wrapper), and a `role="tooltip"` panel wired through `aria-describedby`, so the
sentence is announced rather than merely drawn. `align="right"` pins the panel to the right edge for a
trigger near the edge of its container.

## What a doc here should still cover

- The primitive inventory in `src/components/ui/` and when to reach for each.
- The `Tile` → `TILE_LEDGER` hairline-chrome convention (`Tile` does not
  self-border) used across org pages.
- How landing prototypes are staged behind a tab switcher and what promotes one
  into the brand system; see the `/prototype` skill.
- The 300-LOC-per-`.tsx` ceiling from [`AGENTS.md`](../../../AGENTS.md) and the
  co-located-extraction pattern it prescribes.

## The readable floor (2026-09-20)

The app is dark-only on `#080d1a`, and its de-emphasised text is written with the stock slate ramp:
`text-slate-500` about 1,060 times and `text-slate-600` about 340 — timestamps, ids, units, captions,
em-dash placeholders, mono labels. Measured against the canvas, both were below the readable floor
(4.08:1 and 2.56:1; WCAG AA asks 4.5:1 for body text). `globals.css` re-bases those two shades in
`@theme` — 500 → `#77879d` (5.30:1), 600 → `#64748b` (4.08:1, the de-emphasis step for marks and
placeholders) — which fixes every call site at once and keeps the ramp's order intact.

The alternative, sweeping 1,400 utilities, would have churned three hundred files and left the next
`text-slate-500` anyone typed just as unreadable. `src/app/globals.contrast.test.ts` holds the floor:
it reads the overrides out of the stylesheet, measures every colour the app writes text in against the
canvas, and fails if one drops under AA — a palette regression is one hex in a diff and damage spread
over the whole product, so it is not a thing to catch in review.

## Theme duality and the composition kit (2026-09-29, kit batch 0)

Two looks coexist until the redesign covers every route, then one is retired.

- **Altimeter** is the shipped look and is the *absence* of a theme attribute. **Prism** is the
  candidate identity chosen in the `landing-brand` contest (`docs/design/BRAND-PRISM.md`).
- The header carries an Altimeter / Prism tab switch (`ThemeSlot` reads the theme on the server and hands it to
  the client `ThemeSwitch`, in both `SiteHeader` and `OrgHeader`). The choice is the **cookie**
  `ascent-theme` (`getTheme()` in `src/lib/theme/server.ts`), so the server renders `<html data-theme>` and a
  route may render a different LAYOUT per theme with no flash; `ThemeSwitch` writes the cookie and calls
  `router.refresh()`. A blocking inline script in `<head>` (`src/lib/theme/theme.ts`) only handles a
  `?theme=prism|altimeter` link and a one-time migration of the old localStorage value, reloading once when
  the wanted look differs from what the server rendered (sessionStorage-guarded). Reading the cookie makes
  previously static routes dynamic; that cost is duality scaffolding and goes when one theme is retired.
- **Foundation layer** `src/app/theme-prism.css` re-points the colour tokens under
  `html[data-theme="prism"]` (slate ramp, surface, divider, accent = paper, ink) so every route restyles
  at once. Status colours are deliberately not re-pointed (BRAND-PRISM.md, open conflict 1). What tokens
  cannot reach is literal hex and inline styles: those are the migration backlog.
- **Kit** `src/components/kit/`: `Panel`, `Section`, `StatStrip`/`StatTile`, `KeyValue`,
  `ListRows`/`ListRow`/`RowList`, `ChipRow`/`Chip`, `Toolbar`/`ToolbarReadout`, `Segmented`,
  `SettingRow`, `DataTable`. Each carries its Altimeter look as classes (unchanged from the primitive it
  replaced), a `data-kit` hook and stable `data-role`s; the Prism expression lives in one stylesheet,
  `src/app/kit.css`. The org shared `Card`, `Tile`, `OrgTable` and `SectionHeader` now delegate to the kit,
  so ~180 importers compose from it. A local look-alike of a kit part is a finding.
- **Kit v2 (2026-09-29, kit-1a):** the landing's structure printed into the kit, measured from its computed
  styles (`docs/design/KIT-V2-LANGUAGE.md`, with the owner-veto decisions D1-D5). New parts: `Display`,
  `Eyebrow`, `Lede`, `Caption`, `MonoPath`, `Frame`, `SectionHead`, `LevelNav` (+ client `EscBack`),
  `DimensionLine`, `EvidencePanel`, `Plate`, `SpectralRule`, `HonestyTag`, `PrimaryAction`, `GhostAction`.
  In Prism `.type-label` renders as the sentence-case eyebrow theme-wide, table heads and stat figures take the
  v2 type roles, radii shrink to 3-4px, and the Prism theme adopts the landing's font stacks. Per-module
  redesign recipe and the `<Module>.v2.tsx` chosen-at-the-entry convention: `docs/design/KIT-REDESIGN-PROCESS.md`.
- **Specimen** `/kit` (development only; a production build returns 404) shows the type scale, muting
  levels, Spectral Nine, status colours and every part in its states, plus a v2-language section that sets each primitive beside a crop of the landing it is
  measured from (`public/dev/kit-ref/`), synthetic data throughout, and a batch-3 section (`src/app/kit/KitBatch3.tsx`) for the table options, the shortfall span, masthead tone and `Trend`.
- Exercised on `/org/<slug>?tab=overview` and `?tab=live`. Not yet covered: every other route; the
  remaining literal-colour sites inside those two trees (counts in the kit vault's
  `prism-remainder-kit0.md`).
- **Shooter** `scripts/kit/shoot.mjs` photographs a route per theme and size and fails on console errors.
- **Extracted look-alikes (2026-09-30, pure relocation, Altimeter unchanged):** `Movement` (signed delta arrow, basis and
  spoken sentence; `data-kit="movement"`), `VoidMark` (the `missing` StateSwatch under a role=img wrapper; `void-mark`),
  `FilterMenu` (the multi-select header dropdown, moved from `features/standing/overview`; `filter-menu`, popup role
  `filter-menu-popup`), `HairlineList` (open ruled list, `hairline-list`; the framed variant is `RowList radius="xl"`) and
  `HairlineGrid` (re-exported from `ui`, now carries `hairline-grid`).
- **Kit batch 3 (2026-09-30):**
  - `DataTable` options, all inert when unset: `density="compact"` (~32px rows), `foot` (a `<tfoot>`, Prism rules it
    hair-strong with 600-weight figures), `stickyHead="scroll"|"page"` (`page` pins the head under the app header
    while the page scrolls, from lg up), `stickyFirstCol`, `size="sm"`, `labelledBy` (a focusable named scroll region),
    `headClassName`, `tableClassName`, and `variant`: `plain` (the caller draws frame, row rules and padding; the
    kit supplies Prism head type and tabular figures) or `sheet` (a grid of runs: left rules show only on
    `data-run-start` cells). Migrated onto it: Audit log, Members, Delivery activity table twin, the Live timetable
    ledger, the Knowledge loom grid, the dimension heatmap, the pricing credit matrix and self-host blueprint, the
    landing dimension matrix; `OutcomeSheet` is tagged `data-kit="data-table" data-variant="sheet"`. Contributors and
    Care summary tiles are `StatStrip`/`StatTile`. Not migrated on purpose: the war-room `StatCell` (tweened,
    wall-scale), the on-air Today cell and the desk Rounds figures (their own dark palette and CSS modules), and the
    Skills lifecycle `Figure` (a chart caption, not a stat).
  - **Hue-versus-meaning (ruled 2026-09-30, `docs/design/KIT-HANDOFF.md`):** hue names a dimension and nothing
    else; status travels by glyph and word or by lightness. `DimensionLine` draws a hatched
    `data-role="dimension-shortfall"` span from the value to the floor (Prism only) and desaturates a healthy bar at
    85% or more; `MastheadFigure.tone` (`good|watch|risk`) renders `data-tone`, a leading glyph and a screen-reader
    word with the value in paper (`color` still works for Altimeter callers); matrix cells draw their hue bar only in
    the sorted column and under the pointer.
  - **`Trend`** (`data-kit="trend"`): a 240x56 maturity trend against the level bands the series touches (padded
    one band; `bandDomain`), hairline band edges with 13px labels, first and last values printed, and words instead
    of a line below the forecast minimum (3 points). Used by the Prism Overview masthead; the Live headline
    sparkline takes the same fixed domain in Prism only (`useIsPrism`).
  - `kit.css` first-generation rules that a later rule overrode were deleted (0 changed pixels in the shot diff).

**Additions from the live-tab redesign exercise (2026-09-29):** `useHashFlag(name)` holds one nested level in
the URL hash (`#outcome`; the browser Back button closes it, a deep link opens it after hydration).
`DimensionMark` names a dimension in a cell (mono id in its `--spec-n` hue, unknown ids stay un-hued).
`LevelNav`'s `back`/`prev`/`next` accept `onClick` instead of `href` for a level on the same page (a button
never scrolls). `scripts/kit/drive-live-v2.mjs` drives the level chrome; `scripts/kit/roles/live.json` is the
Live cockpit's computed-style contract for `roles-check.mjs`.


## Prism readability and patterns (2026-09-30)

- **Muted text:** in Prism the slate 400/500/600 ramp is lifted (>= 6.0:1 on graphite), `type-micro` is 13px, and a
  static `opacity-40..70` on a `text-slate-*` element is floored at 0.85 so a fade never stacks on a mute.
- **Background patterns:** a faint 48px page grid, and `data-pattern` = `grid | dots | hatch | spectral` on any kit part
  (`pattern` prop on `Frame`, `Panel`, `Masthead`). `hatch` means not measured; `spectral` marks a dominant section.
  Specimen: `/kit`, "Patterns". Altimeter is unaffected.
- **Tables and dimension lines:** `DataTable` is a top/bottom hairline band with 15px rows, paper hover/selected states and
  sans tabular figures; dimension lines get a visible floor mark. Masthead page statement scales 2.625rem (3rem >= 1600px).

## Form field, pressable row, ladder (2026-09-30)

- `FormField` + `Input` / `Select` / `Textarea`: a labelled control with a hint or an error. An error is a glyph and a
  word (`role="alert"`), never colour alone. Prism squares the control to 4px and lights the border on focus.
- `ListRow` takes `onPress` (the whole row becomes a button, client callers only) and `selected` (the open row).
- `Ladder` and `CellMark`: status without hue. Tiers, bands and matrix cells say reached / current / open / not
  measured (or met / partial / missing / not measured) as a glyph, a word and a lightness; unknown is hatched.
  Use these instead of colouring a measured cell by score. Specimen: `/kit`, "Batch 4".
