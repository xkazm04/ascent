# Biz+Bug Scan — Marketing Site & Design System — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 3 contexts.
> Total: 15 findings — Critical: 0, High: 3, Medium: 9, Low: 3  (bug: 9, business: 6)

---

## Design System: UI Primitives & Deck

### 1. DeckNav active-section indicator can point at the wrong section
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/deck/DeckNav.tsx:18-29
- **Scenario**: While scroll-snapping between two adjacent full-viewport sections, the IntersectionObserver callback can report several entries in one batch. The loop `for (const e of entries) if (e.isIntersecting) setActive(e.target.id)` keeps whichever intersecting entry is **last in array order**, which IO does not guarantee to be the most-centered one. The right-edge dot then highlights a section the user isn't on.
- **Root cause / Rationale**: The handler treats "any intersecting" as "active" instead of picking the entry with the greatest `intersectionRatio`; the 10% activation band (`rootMargin -45%/-45%`) is crossed by two sections during the snap transition.
- **Impact**: Wrong nav state on the flagship `/` and `/about` decks — a small but visible correctness defect on the most-polished surface.
- **Fix sketch**: In the callback, reduce `entries` to the intersecting entry with the highest `intersectionRatio` (track a running max) before calling `setActive`, or sort by `boundingClientRect` distance to viewport center.

### 2. Deck section nav is desktop-only — no jump nav on tablet/mobile
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: accessibility
- **File**: src/components/deck/DeckNav.tsx:32
- **Scenario**: `DeckNav` is `hidden ... lg:flex`. On a scroll-snap deck (`useSnapDeck` makes snapping mandatory via globals.css) every viewport below `lg` — i.e. all phones and most tablets — loses the only affordance for moving between the 6–8 chapters, forcing one-section-at-a-time scrolling with no overview/skip.
- **Root cause / Rationale**: The dots were designed as a desktop accent and never given a small-screen equivalent; the deck pages have no in-page table of contents otherwise.
- **Impact**: Degraded navigation/orientation for the majority (mobile) of marketing traffic; harder to reach Pricing/CTA = lost conversions.
- **Fix sketch**: Add a compact mobile variant (a bottom progress bar with prev/next, or a collapsible section menu) rendered below `lg`, reusing the same `sections` array.

### 3. Index-keyed nav items + silent background contract in shared primitives
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/components/ui/SideNav.tsx:77-85
- **Scenario**: Groups/items are keyed by array index (`key={gi}`, `key={i}`). `SideNav` is reused for the **state-based report tabs** whose item set changes with data availability; when items are inserted/removed, React reconciles by position and the `aria-current`/active wash can stick to the wrong row. (Companion footgun: `HairlineGrid` silently collapses its hairline illusion if a child forgets its own `bg-*`.)
- **Root cause / Rationale**: Index keys are fine for the static org rail but unsafe for the dynamic tab usage the same component advertises.
- **Impact**: Occasional wrong active-tab highlight / focus mismatch on the report nav.
- **Fix sketch**: Key items by a stable `item.href ?? label` and groups by `group.label`; document the `HairlineGrid` child-bg requirement with a default `bg-ink` cell wrapper.

### 4. Productize the brand kit as white-label / branded reports (Enterprise lever)
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/ui/index.ts:1-14
- **Scenario**: Surface/Kicker/Dateline/Stat already centralize every color, radius, and type token (the whole app themes through them). An Enterprise buyer evaluating ascent vs SonarCloud/Snyk wants shared reports/badges carrying **their** logo and palette for exec and audit audiences.
- **Root cause / Rationale**: Because theming is single-sourced, swapping `--accent`/logo per-org is a small lift that unlocks a concrete upsell rather than a rebuild.
- **Impact**: New Enterprise revenue line + stickier reports (every shared white-label report markets the buyer internally, not just ascent).
- **Fix sketch**: Drive primitive colors from CSS variables resolved from an org "brand" record; gate logo/palette overrides behind the Enterprise tier; reuse the existing PDF/badge pipeline.

### 5. Turn the score ring + deck motion into shareable social/OG cards
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/components/landing/prototypes/index/ScoreGauge.tsx:14-67
- **Scenario**: The animated index ring and the Reveal/deck system are striking but trapped on-site. A repo owner who scores well has no auto-generated, branded image to post.
- **Root cause / Rationale**: The SVG instrument is already deterministic and themeable — rendering a static per-repo OG card (score + level + ring) is mostly wiring it into an `opengraph-image` route.
- **Impact**: Viral loop — every shared report/tweet renders an ascent-branded card linking back; cheap top-of-funnel growth vs paid acquisition.
- **Fix sketch**: Add a dynamic `opengraph-image.tsx` for `/report/[repo]` that composes ScoreGauge + headline metrics; reuse `LEVEL_HEX`/`format.ts` so the card can't drift from the rubric.

---

## Landing Page Prototypes

### 1. Pricing section has no purchase/CTA path — direct revenue leak
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/landing/prototypes/index/PricingCards.tsx:21-49
- **Scenario**: Every tier card renders a feature list and a footnote but **no button**. A visitor convinced by the Private ("Prepaid credits") tier has nowhere to click to buy; the Enterprise card has no "Contact sales." The shared copy even ships "Indicative; final rate TBD" publicly (shared/content.ts:52).
- **Root cause / Rationale**: The cards are informational mockups; the conversion action (Polar checkout / sales lead) was never wired in.
- **Impact**: Purchase-ready demand dead-ends on the pricing screen — the clearest monetization gap on the funnel.
- **Fix sketch**: Add a per-tier CTA (Public → open ScanModal; Private → Polar credit-pack checkout; Enterprise → contact/lead form). Replace "final rate TBD" with a concrete starting price or "from $X".

### 2. The public "register" is a buried deck section, not a standalone destination
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/components/landing/prototypes/index/IndexGallery.tsx:35-117
- **Scenario**: The live leaderboard of AI-native repos — ascent's strongest differentiator vs Snyk/SonarCloud — only renders when `gallery` exists and lives as section #3 inside a client-rendered snap deck. There is no crawlable `/index` (or `/register`) URL and no per-repo rank page to share or rank in search.
- **Root cause / Rationale**: It was built as landing chrome, not as its own SEO/virality product surface.
- **Impact**: A built-in growth loop (each ranked repo = a shareable, indexable page; "claim your rank") is left unrealized; organic discovery is capped.
- **Fix sketch**: Promote the register to a server-rendered `/index` route with paginated per-repo entries and OG cards; keep the deck section as a teaser linking into it; add "claim/share your rank."

### 3. ScanModal locks signed-in members out of scanning on any viewer-fetch error
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/landing/prototypes/index/ScanModal.tsx:129-139,184
- **Scenario**: On a gated deploy, sign-in state is resolved via `fetch("/api/auth/viewer")` with `.catch(() => setSignedIn(false))`. Any transient network/5xx blip makes `locked = gated && signedIn !== true` stay true, so an already-authenticated member sees the "Sign in to scan" wall — with no retry path short of a full reload.
- **Root cause / Rationale**: A failed/again-needed auth probe is treated as "definitely signed out" instead of "unknown," and the result is cached for the page lifetime.
- **Impact**: Legitimate members silently lose the ability to start a scan from the hero — lost activations on the primary CTA.
- **Fix sketch**: On error keep `signedIn = null` and show a "couldn't verify — retry" affordance, or re-probe on dialog open; fail toward letting the server-side gate make the real decision rather than blocking client-side.

### 4. ScanModal's useSearchParams can force the marketing homepage to render dynamically
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/components/landing/prototypes/index/ScanModal.tsx:107
- **Scenario**: `useSearchParams()` runs inside ScanModal, which is mounted on `/` via IndexHero. In the Next app router, a client subtree reading search params with no enclosing `<Suspense>` boundary de-opts the route — the static marketing homepage falls back to dynamic/client rendering (or trips a build error), hurting TTFB and cacheability for the highest-traffic page.
- **Root cause / Rationale**: The `?scan=1` deep-link convenience pulls a dynamic API into a statically-optimizable page without isolating it behind Suspense.
- **Impact**: Slower, less-cacheable homepage; a fragile build characteristic that can surface as a CI failure after a Next minor bump.
- **Fix sketch**: Wrap the `useSearchParams`-dependent part in `<Suspense fallback={…}>`, or read the param via a tiny Suspense-isolated child, keeping the rest of the landing statically rendered.

### 5. Gated deploys flash the sign-in wall to authenticated members
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/landing/prototypes/index/ScanModal.tsx:104,184
- **Scenario**: `signedIn` starts `null`, so `locked` is true until `/api/auth/viewer` settles. A signed-in member who opens the dialog quickly sees the "Sign in to scan" panel for a beat before it swaps to the scan form.
- **Root cause / Rationale**: Deliberate fail-closed default with no skeleton/loading state for the resolving window.
- **Impact**: Momentary confusing/disheartening UX on the conversion surface (and permanent if the fetch errors — see #3).
- **Fix sketch**: Render a neutral "checking access…" placeholder while `signedIn === null` instead of the sign-in wall; only show the wall once a definitive signed-out result arrives.

---

## Marketing About Page

### 1. AboutAscentSteps hardcodes 5 Y-positions — coupling landmine vs LEVELS
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/about/AboutAscentSteps.tsx:13,27
- **Scenario**: The staircase derives steps from `LEVELS` but reads platform heights from a fixed `YS = [300,250,200,150,100]` via `YS[i]!`. Everything else in the app (ScoreGauge, DimensionMatrix, TrajectoryChart) scales off `LEVELS.length`. If a sixth level is ever added to the rubric, `YS[5]` is `undefined` → `y: undefined` → `NaN` SVG coords → the staircase and climber silently break, with no type error (the `!` asserts it away).
- **Root cause / Rationale**: A hand-tuned layout constant tightly coupled to a model that the rest of the codebase treats as variable-length.
- **Impact**: Silent visual breakage on `/about` the moment the maturity model grows.
- **Fix sketch**: Compute `y` from index and a base/step (`baseY - i * rise`) so the staircase derives from `LEVELS.length` like its siblings; drop the non-null assertion.

### 2. about/page.tsx uses existsSync(public/...) — prod/local divergence
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/app/about/page.tsx:18
- **Scenario**: The hero backdrop is chosen via `existsSync(join(process.cwd(), "public", HERO_BG))`. On a bundled/serverless prod target (AWS), `public/` assets are served by the CDN and may not sit under the server bundle's `process.cwd()`, so `existsSync` returns false in prod even though `/brand/proto/about-hero-bg.png` is reachable — silently dropping the hero backdrop in production while it works locally.
- **Root cause / Rationale**: Filesystem probing for a static asset assumes the dev filesystem layout; it also adds a sync `stat` per render and can force the page dynamic.
- **Impact**: Hero looks intentionally degraded in prod-only; hard-to-reproduce "works on my machine" visual bug.
- **Fix sketch**: Drop the fs probe — render the `<Image>` unconditionally (Next serves/optimizes it) with a CSS strata/glow fallback via `onError`, or gate on a build-time env flag instead of runtime `existsSync`.

### 3. Risk radar shows "Gate Pass" while a risk stays unmitigated
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/about/risk/RadarComposition.tsx:23-27
- **Scenario**: `gate` flips to "pass" once `criticalOpen === 0`, but the last blip (radar.ts:34, beyond `WAVE_MAX`) is non-critical and never mitigated, so the overlay simultaneously renders **"Gate Pass"** and **"open risks: 1."** In a marketing animation that pitches "catch it early," the self-contradiction reads as a glitch and undercuts credibility.
- **Root cause / Rationale**: Gate semantics (criticals only) are correct but visually collide with the still-counting open-risks metric, with no annotation explaining the distinction.
- **Impact**: Minor trust/polish ding on a flagship diagram.
- **Fix sketch**: Either mitigate the trailing blip before the gate flips, or label the gate "Critical-clear" / annotate the lingering open risk so PASS-with-1-open is legibly intentional.

### 4. RoiSimulator runs on fake repos — make it run on the visitor's real org
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation
- **File**: src/components/about/RoiSimulator.tsx:20-29
- **Scenario**: The centerpiece what-if simulator is driven by 8 hardcoded `REPOS`. A visitor sees a generic demo, not their own payoff. The biggest activation moment — "this moves 6 of 8 of **your** repos to L3" — is left on the table.
- **Root cause / Rationale**: It's a static illustration; there's no path to seed it from a real (even unauthenticated, lightweight) org estimate.
- **Impact**: Missed personalized "aha" that converts browsers to connect/scan; competitors' ROI calculators that ingest real data convert far better.
- **Fix sketch**: Add an optional "try it on your org" input that fetches a cheap public-repo estimate to seed the bars, then nudges to a full `/connect` scan for the real numbers.

### 5. About CTAs dump straight into GitHub connect — no lower-friction lead capture
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/components/about/AboutCTA.tsx:27-34
- **Scenario**: Every About CTA (hero + closing) routes to `/connect` (GitHub OAuth/app install) or the demo. A buyer-influencer not ready to authorize a GitHub App on their org has no way to stay in the funnel — no "email me my org's sample report / a maturity guide."
- **Root cause / Rationale**: The funnel assumes immediate readiness to cross the high-friction GitHub-connect wall.
- **Impact**: Top-of-funnel leakage of warm-but-not-ready leads; no remarketing list.
- **Fix sketch**: Add a lightweight email-capture CTA ("Get a sample org report" / "AI-native maturity guide") that stores the lead and triggers a nurture email via the existing SES path, alongside the connect button.
