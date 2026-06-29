# Biz+Bug Scan — Onboarding, Shell & AI Standard — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 6 contexts.
> Total: 29 findings — Critical: 0, High: 5, Medium: 16, Low: 8  (bug: 17, business: 12)

---

## Dev Inspector

### 1. setTimeout scheduled inside a setState updater double-fires in StrictMode
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/_dev-inspector/DevInspector.tsx:96-103
- **Scenario**: Pressing `;` runs `setMode((m) => { … navTimer.current = setTimeout(…); return "nav"; })`. React StrictMode (dev — the only env this mounts in, layout.tsx:83) intentionally double-invokes updaters, so two timers are created but only one handle is stored in `navTimer.current`; the orphaned timer still fires after 2s and can flip `nav → off`.
- **Root cause / Rationale**: A side effect (timer creation) lives inside a pure-by-contract reducer.
- **Impact**: Flaky nav-mode timeout; the inspector occasionally disarms itself before the dev presses `i`. Dev-only, low blast radius.
- **Fix sketch**: Set `mode` in the updater, then arm/clear the timer in a `useEffect` keyed on `mode === "nav"`.

### 2. Armed mode swallows the native context menu document-wide
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/app/_dev-inspector/DevInspector.tsx:152-161
- **Scenario**: While armed, the capture-phase `contextmenu` handler `preventDefault()`s on every element outside the HUD. A dev who forgets to `Esc` loses right-click on inputs/links/text everywhere, and any stray right-click silently copies a loc.
- **Root cause / Rationale**: Global capture handler with no opt-out for editable/interactive targets.
- **Impact**: Mild dev-workflow friction; no production effect.
- **Fix sketch**: Skip `preventDefault` when `isTypingTarget(e.target)` or the target is a link, and/or require a modifier to arm-copy.

### 3. buildChain runs on every mousemove over the whole document with no throttle
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: performance
- **File**: src/app/_dev-inspector/DevInspector.tsx:134-148 (buildChain at devLocate.ts:49)
- **Scenario**: Armed mode attaches a capture `mousemove` that walks every `[data-loc]` ancestor and calls `getBoundingClientRect()` twice per event. On a dense page this is heavy per-pixel work.
- **Root cause / Rationale**: No rAF throttle / movement gate.
- **Impact**: Janky highlight on large pages; dev-only.
- **Fix sketch**: Throttle `onMove` with rAF or a small movement threshold; cache the chain for the same `e.target`.

### 4. Reuse the data-loc → source-locator pattern in customer reports
- **Severity**: Low
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/app/_dev-inspector/devLocate.ts:48-69
- **Scenario**: Ascent already maps a DOM node back to `src/File.tsx:LINE`. The product sells code *legibility*; reports could let a user click a finding/evidence chip and deep-link to the exact `file:line` (or owning `CONTEXT.md`) on GitHub.
- **Root cause / Rationale**: The internal locator is exactly the "where in my code is this?" affordance competitors' findings lists lack.
- **Impact**: Differentiated report UX; tightens the scan → fix loop.
- **Fix sketch**: Persist evidence `path:line` from the scanner and render GitHub permalinks in report findings, reusing `splitLoc`/`parseLoc`.

---

## App Shell, SEO & Error Pages

### 1. The public Leaderboard is missing from the sitemap
- **Severity**: High
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/app/sitemap.ts:18-25 (page exists at src/app/leaderboard/page.tsx; linked from Brand.tsx:52,127)
- **Scenario**: `/leaderboard` is public, indexable, and the single most viral/SEO-valuable surface (rankings → backlinks → "where's my repo?" searches), yet it is absent from `sitemap.ts` while lower-value `/badge`, `/trends`, `/usage` are listed. Robots allows it, so crawlers only reach it by link-following.
- **Root cause / Rationale**: The sitemap list wasn't updated when the leaderboard feature landed on this branch.
- **Impact**: Lost organic discovery of the prime growth-loop page.
- **Fix sketch**: Add `{ path: "/leaderboard", priority: 0.8 }` (and `/about`) to the routes array; assert its presence in seo.test.ts.

### 2. JSON-LD advertises the product as free (`price: "0"`)
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/layout.tsx:57
- **Scenario**: Site-wide structured data declares `offers: { price: "0", priceCurrency: "USD" }`. Ascent has Polar billing, credits, and paid tiers, so search engines may surface a "Free" rich-result and anchor prospects on $0.
- **Root cause / Rationale**: A placeholder offer shipped in the global schema.
- **Impact**: Undercuts pricing perception in SERPs/knowledge panel; conversion drag.
- **Fix sketch**: Drop the `offers` block (or model the real tiers with `AggregateOffer`/`lowPrice`), keeping it in sync with `/pricing`.

### 3. The 404 page can degrade into the chrome-less 500
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/not-found.tsx:8-11 (SiteHeader at Brand.tsx:30-42)
- **Scenario**: `not-found.tsx` renders the async `SiteHeader`, which awaits `getSession()`/`getActiveOrg()` (auth + DB). If the DB/auth throws during a 404 render (e.g., an Aurora DSQL token blip), the not-found render itself throws and falls through to the bare `global-error.tsx` 500 — a simple "page not found" becomes a scary unbranded crash.
- **Root cause / Rationale**: A non-critical boundary depends on a fragile session/DB path with no try/catch.
- **Impact**: Worse UX on the exact transient failures the health route exists to self-heal.
- **Fix sketch**: Wrap the header's session lookup in a guard (render a logged-out header on failure) or use a lightweight static header in `not-found.tsx`.

### 4. Error boundaries have no telemetry — production errors are invisible
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/error.tsx:25-27, src/app/global-error.tsx (no reporter)
- **Scenario**: Both app-wide boundaries only `console.error`. In production there's no Sentry/log drain hook, so an error storm (or a single high-impact `digest`) is never alerted on; the team learns about outages from users.
- **Root cause / Rationale**: Observability wasn't wired into the boundaries.
- **Impact**: Blind to client crashes — unacceptable for a security/maturity product's own shell.
- **Fix sketch**: Report `error`/`digest` to a tracker in the `useEffect`, and POST a minimal beacon from `global-error` (it runs without the router) to `/api/health`-style sink.

### 5. Default OG card hardcodes "9 dimensions / 5 levels" instead of deriving from the model
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/app/opengraph-image.tsx:24-26,30
- **Scenario**: The fallback social card prints "5-level ladder across 9 dimensions" and renders fixed `L0..L4` chips, while `layout.tsx:18` builds the same description from `LEVELS.length`/`DIMENSIONS.length`. A rubric change updates the meta text but not the OG image — every share would then misstate the model.
- **Root cause / Rationale**: Two sources of truth for the same counts.
- **Impact**: Latent marketing drift on the most-shared asset.
- **Fix sketch**: Derive the chips and counts from `LEVELS`/`DIMENSIONS` in the OG component.

---

## AI-Native Standard & Onboarding Skill

### 1. Generated CI runs `doctor.mjs --run`, which execSyncs manifest commands (fork-PR RCE)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/lib/standard/doctor.ts:80-86,144-151
- **Scenario**: The product tells repos to wire `node .ai/doctor.mjs` into CI (skill.ts:170-173) and `--run` `execSync`s each capability command read verbatim from `.ai/manifest.yaml`. If that workflow triggers on `pull_request` from forks (a common default), a PR that edits a manifest capability to `curl … | sh` runs arbitrary code in CI with its secrets — including `ASCENT_CONFORMANCE_TOKEN`, which the same script exfiltrates to `ASCENT_CONFORMANCE_URL`.
- **Root cause / Rationale**: Shift-left conformance executes untrusted, PR-mutable commands; the recommended wiring doesn't pin trust.
- **Impact**: Supply-chain / secret-exfil risk in adopters' pipelines — reputational blast radius for Ascent.
- **Fix sketch**: Emit `ai-conformance.yml` gated to `push`/protected branches (or `pull_request_target` without checkout of fork code); document "never `--run` on fork PRs"; have the doctor refuse `--run` when `GITHUB_EVENT_NAME=pull_request` and the manifest changed in the diff.

### 2. Conformance ingest is unvalidated and wholly self-attested
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/app/api/report/conformance/route.ts:17-20,35-52
- **Scenario**: `int()` accepts any finite integer, so a caller (the repo's own doctor, or anyone with `requireOrgAccess`) can `POST { score: 999999, fails: -5 }` and it's `recordConformance`'d onto the Repository row and shown on the dashboard. The whole number is self-reported by `doctor.mjs` with no server re-derivation.
- **Root cause / Rationale**: No range/clamp validation; conformance is trusted as fact.
- **Impact**: A repo can fake "100% conformant," corrupting the org rollup and eroding the credibility Ascent sells.
- **Fix sketch**: Clamp `score` to 0–100 and `fails`/`warns` to ≥0; store + display it as "self-reported," and reconcile against the next real scan.

### 3. Productize the adopt → verify → re-score loop (the real moat)
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/lib/standard/index.ts:27-36, src/app/api/report/conformance/route.ts
- **Scenario**: Snyk/SonarCloud/Scorecard *report*; Ascent uniquely *ships a fix harness* (`.ai/` standard + executable doctor) and closes the loop by ingesting conformance and showing the maturity delta. Today that loop is a one-off `SKILL.md` download with no recurring surface or paywall.
- **Root cause / Rationale**: The strongest retention/differentiation mechanic is buried behind a file export.
- **Impact**: Leaves the core wedge (continuous, verifiable improvement) un-monetized and under-marketed.
- **Fix sketch**: Make "Continuous Conformance" a paid tier — scheduled doctor ingestion, a conformance-trend chart, regression alerts, and a public "conformance: NN%" badge driving inbound.

### 4. Publish `.ai/` as a named, vendor-neutral standard with a "powered by" badge
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/lib/standard/manifest.ts:97-141 (references docs/AI_MANIFEST_SPEC.md)
- **Scenario**: The manifest is already designed as a stable, tool-neutral spec. Releasing it publicly (spec site + a `.ai/`-adopted badge) turns every scanned repo into a distribution surface and positions Ascent as the standard-setter for agent-legible repos.
- **Root cause / Rationale**: A standard with a visible badge creates a network/adoption loop competitors can't easily copy.
- **Impact**: Category ownership + organic growth from adopter repos.
- **Fix sketch**: Host AI_MANIFEST_SPEC publicly, add a README badge to `buildFoundation` output linking back to the spec/your scan.

### 5. Skill route conflates a DB error with "no saved scan"
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/report/skill/route.ts:32-41
- **Scenario**: `getScanReportByCommit(...).catch(() => null)` returns null on a transient DB failure exactly as it does for a genuinely un-scanned repo, so the user gets a 404 "Scan it first, then export" and is told to re-run a scan that already exists.
- **Root cause / Rationale**: A blanket `.catch` erases the error/empty distinction.
- **Impact**: Misleading guidance + wasted re-scan (a credit) during a DB blip.
- **Fix sketch**: Let DB errors propagate to a 503 (matching the report PDF route's contract); only 404 when the lookup truly resolves empty.

---

## Launch Fleet Map

### 1. The 90s refresh can dim a just-scanned star back to its stale score
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/launch/FleetMap.tsx:112-140 (mergeStars.ts:6-15, applyScanEvent.ts)
- **Scenario**: A user scans an org from the map; SSE brightens its stars via `applyScanEvent` (which writes only `overall`/`level`). The scan completes and clears `scanCtrl.current`. Within 90s the live-refresh pulls `/api/app/repos`; if that endpoint hasn't yet reflected the fresh scores, `mergeStars` swaps the bright star back to the stale `overall` and it visibly dims.
- **Root cause / Rationale**: Two writers (SSE + poll) with no version/recency guard; the poll only skips *during* an in-flight scan, not the propagation window after it.
- **Impact**: The headline "watch your fleet light up" moment flickers backward — looks broken.
- **Fix sketch**: Keep the max(prev, fresh) score per star, or stamp scan results with a timestamp and let `mergeStars` prefer the newer; debounce the first refresh well past a scan's completion.

### 2. A failed org scan from the map is completely silent
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/launch/FleetMap.tsx:62-77
- **Scenario**: `scanOrg` does `if (!res.ok || !res.body) return;` and the surrounding `catch {}` swallows network errors. On a 402/403/500 the Scan button just re-enables with no toast, no row error — the user assumes the org has nothing to scan.
- **Root cause / Rationale**: No error state plumbed back to the constellation card.
- **Impact**: Confusing dead-end at an activation surface; masks credit/permission failures.
- **Fix sketch**: On non-ok/exception, set the constellation to a transient error/message (reuse the `status:"error"` card) instead of returning silently.

### 3. Live polling fans out N unaborted GitHub-App fetches every tick
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: performance
- **File**: src/components/launch/FleetMap.tsx:112-140
- **Scenario**: Every 90s `refreshAll` fires one `/api/app/repos` per installation regardless of whether anything changed, with no `AbortController` — on unmount the in-flight responses still resolve (ignored), and a many-org user generates steady background load on a token-minting endpoint.
- **Root cause / Rationale**: Coarse full-fleet repoll + missing abort signal.
- **Impact**: Wasted GitHub API budget / server cost; minor leak.
- **Fix sketch**: Pass an abort signal, stagger/condition the repoll (only visible + only orgs with recent movement), and back off when the tab is hidden.

### 4. No public, shareable fleet map
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/app/launch/page.tsx:36-53
- **Scenario**: The cinematic constellation is the most screenshot-worthy thing in the product, but it's entirely session-gated; there's no public fleet map for the demo org or any public org and no share link.
- **Root cause / Rationale**: A viral asset locked behind auth.
- **Impact**: Forfeits a strong top-of-funnel / social-proof surface (the OG image already renders a constellation — the live version stays private).
- **Fix sketch**: Render a read-only `/launch/<publicOrg>` (or wire the demo org) reusing `FleetMap` with a "Connect yours" CTA + share button.

### 5. "Movers · 30d" is computed but never re-engages the user
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/components/launch/fleetMapDerive.ts:19-49 (risers/fallers); src/components/launch/FleetMap.tsx:197-199
- **Scenario**: The map already derives per-fleet risers/fallers, but that signal lives only on a page users must visit. There's no proactive nudge.
- **Root cause / Rationale**: A ready-made re-engagement payload isn't sent anywhere (SES is already in the stack).
- **Impact**: Misses a high-signal weekly retention loop ("2 repos rose, 1 dropped").
- **Fix sketch**: A weekly "fleet movement" email digest built from `fleetStats`, deep-linking back to the map/dashboard.

---

## Connect & Repo Selection

### 1. Rapid watch/unwatch toggles race on the wire
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/connect/InstallationRepos.tsx:197-235
- **Scenario**: `toggleWatch`/`changeSchedule` fire independent POSTs with no sequencing or in-flight lock per row. A user double-clicking watch issues watch-then-unwatch; if responses arrive out of order (or the later request is processed first server-side), the persisted state can end up the opposite of the optimistic UI — and rollback only triggers on non-2xx, so a 2xx for the *wrong* final state shows success.
- **Root cause / Rationale**: Optimistic updates without request ordering / last-write reconciliation.
- **Impact**: A repo the UI shows as watched silently isn't (or vice-versa) → scheduled scans never run, or run unexpectedly (credit burn).
- **Fix sketch**: Disable the row control while its mutation is in flight, or tag requests with a monotonic seq and ignore stale responses; reconcile to the server's echoed state.

### 2. No buy-credits / upgrade CTA at the "autoscans pause at zero" warning
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/connect/InstallationRepos.tsx:349-351,389-391
- **Scenario**: When `underAMonth` is true the UI warns "covers under a month; autoscans pause at zero" — the exact moment of purchase intent — but offers no top-up or upgrade action.
- **Root cause / Rationale**: The cost disclosure stops at warning; the conversion path is missing.
- **Impact**: Leaves money on the table at peak intent and risks silent autoscan lapse (churn).
- **Fix sketch**: Render a "Top up credits / upgrade plan →" button next to the warning, deep-linking to Polar checkout pre-filled for this org.

### 3. Bulk "Schedule watched" commits recurring spend with no confirmation
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/connect/InstallationRepos.tsx:286-314,406-422
- **Scenario**: Choosing a cadence in "Schedule watched" instantly sets, say, daily autoscans across 200 watched repos — a large recurring credit commitment — behind a single dropdown change with only a passive cost line.
- **Root cause / Rationale**: A high-cost action lacks a commitment gate.
- **Impact**: Bill shock / refund disputes / trust erosion (and inverse: users avoid scheduling for fear of cost).
- **Fix sketch**: When the bulk action's estimated monthly credits exceed the balance (or a threshold), show a confirm dialog stating "≈N credits/month" before POSTing.

### 4. Repo-list error JSON is parsed unguarded, mislabeling server failures
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/connect/InstallationRepos.tsx:61-69
- **Scenario**: `const data = await r.json();` runs before the `r.ok` check. A non-JSON error body (a proxy 502 HTML page, gateway timeout) throws in `.json()` and is caught by the generic `.catch` → the user sees "Network error." even though the network was fine and the server failed.
- **Root cause / Rationale**: JSON parse not isolated from the ok/branching logic.
- **Impact**: Misdiagnoses outages as the user's connection; obscures real server errors.
- **Fix sketch**: `await r.json().catch(() => null)` and branch on `r.ok` first, surfacing the status code when the body isn't JSON.

### 5. Add per-org scan-budget caps as a governance (paid) feature
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/connect/InstallationRepos.tsx:339-393 (watch/schedule surface)
- **Scenario**: The connect surface already manages watch + schedules + segments + credits — a strong fleet-governance story vs. competitors. A natural paid add-on: a spend cap ("auto-pause autoscans for this org at N credits/month") so platform teams can delegate scanning without runaway cost.
- **Root cause / Rationale**: Enterprise buyers need cost guardrails; the data/levers already exist.
- **Impact**: New upsell + de-risks the very bill-shock that suppresses scheduling adoption.
- **Fix sketch**: Add an org budget field; the cron checks it before charging; surface a cap control beside the credit strip.

---

## First-Run Onboarding Wizard

### 1. Clicking "Scan" before credits load runs a mock on a paying org
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/onboarding/OnboardingFlow.tsx:204-213,280-281 (canRunReal.ts:16-23)
- **Scenario**: `loadInstallationRepos` fetches `/api/org/credits` fire-and-forget; `credit` stays null until it resolves. If a fast user clicks Scan on the select step first, `canRunRealScan` sees `credit == null` → returns false → the wizard runs a disclosed *preview/mock* even though the org has credits and a real scan was intended.
- **Root cause / Rationale**: The money-gate decision reads state populated by an un-awaited fetch.
- **Impact**: A real, paying customer's first scan is fabricated numbers → "this product is fake" first impression; their credits/value go untouched.
- **Fix sketch**: Disable Scan (or show "checking balance…") until the credit read settles for `sourceLabel`; or await it inside `startScan` before deciding.

### 2. Public-path source label keeps original case → dashboard link can 404
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/onboarding/OnboardingFlow.tsx:167,183 vs 233-236
- **Scenario**: The App path deliberately lowercases `sourceLabel` because "private scans persist under the lowercased owner slug and the org dashboard resolves the slug exactly — or the View dashboard link would 404." The public path (`loadRepos`) sets `setSourceLabel(handle)` with original case. The import route persists under `org.trim().toLowerCase()` (api/org/import/route.ts:65), so after scanning a mixed-case handle (e.g. `Facebook`), `onViewDashboard`/checklist build `/org/Facebook` → 404.
- **Root cause / Rationale**: The case-normalization fix was applied to the App path only.
- **Impact**: The wizard's terminal "View dashboard →" CTA dead-ends right at activation.
- **Fix sketch**: `setSourceLabel(handle.toLowerCase())` in `loadRepos` (matching the App path), or make `/org/[slug]` resolve case-insensitively.

### 3. Public onboarding scans are mock-only — fabricated first-run "wow"
- **Severity**: High
- **Lens**: business-visionary
- **Category**: activation
- **File**: src/components/onboarding/OnboardingFlow.tsx:278-281 (importScan.ts:64-72)
- **Scenario**: The public-handle funnel always sends `mock: true` (no installation id → `canRunReal` false), so a first-time visitor scanning a public repo through onboarding sees preview/fake scores — even though the main `/report?repo=` path scans public repos for real with no credits. The highest-intent first run shows the least trustworthy numbers.
- **Root cause / Rationale**: Onboarding gates *all* real scans behind credits, conflating "public repo" (free to scan) with "needs credits."
- **Impact**: Weak/dishonest activation; users may bounce believing the scores are made up.
- **Fix sketch**: Route public-repo onboarding scans through the real public scanner (which needs no credits), reserving mock only for credit-less *private* orgs.

### 4. 45s stall watchdog can false-abort a slow real scan
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/onboarding/importScan.ts:6,50-56,86
- **Scenario**: `armStall()` re-arms on every SSE chunk with a 45s window. A real LLM scan of one large repo can take longer than 45s between per-repo `repo` events; with no intermediate progress frame the watchdog aborts a perfectly healthy scan as "stalled."
- **Root cause / Rationale**: The timeout assumes sub-45s inter-event gaps, which heavy real scans violate.
- **Impact**: Valid first scans fail with "The scan stalled" → lost activation + a refunded-but-confusing run.
- **Fix sketch**: Raise the window (e.g. 120s) and/or have the server emit periodic heartbeat/progress frames so the watchdog tracks liveness, not per-repo completion.

### 5. No top-up/free-trial CTA at the money gate; recurring watch auto-enrolled
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/components/onboarding/importScan.ts:11,70-71; OnboardingFlow.tsx:280-281
- **Scenario**: Every import sends `watch:true, schedule:"weekly"`, silently enrolling first-run repos into a recurring credit commitment (disclosed in the select step, but on by default), while a credit-less org just degrades to a preview with no "start a trial / buy credits" path.
- **Root cause / Rationale**: The activation flow neither converts the credit-less user nor lets them opt out of recurring spend.
- **Impact**: Misses the conversion moment and risks a trust hit from default recurring enrollment.
- **Fix sketch**: Offer N free real scans (trial) or a checkout nudge when `!canRunReal`; make the weekly auto-watch an explicit opt-in toggle on the select step.
