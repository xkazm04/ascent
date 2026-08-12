# Onboarding & launch

Two surfaces get a new user from "never scanned" to "looking at a cross-repo dashboard":
the **onboarding flow** (pick an org → select repos → scan → done) and the cinematic
**launch** page (a constellation star-map of the user's fleet, shown right after first
sign-in).

## Onboarding (`src/app/onboarding/page.tsx`, `src/components/onboarding/`)

`OnboardingFlow` is a four-phase state machine; all of its state, effects and handlers live in
the co-located `useOnboardingFlow` hook (the component is the view layer).

| Phase | What happens |
| --- | --- |
| **pick** | Choose a source: a GitHub **App installation** (private repos included, via `/api/app/repos`), a discovered/suggested org chip, or a free-text org/user handle (public listing, via `/api/org/repos`). A `?org=<handle>` query param — used by the connect page's discovered-org chips — starts the public path immediately. |
| **select** | Up to 10 selectable. The public listing is ordered most-recently-pushed and discloses when it was cut short (`truncated`); the App listing is ordered by stars → recent activity. Preselection is by prominence (stars, then recency) in both. Sticky action bar with "Select top 10" / "Clear", plus the cost disclosure + autoscan **opt-in** (see below). |
| **scanning** | Stream SSE from `POST /api/org/import` (`{ org, repos, mock, watch, schedule }`); per-repo live progress (level + score, error, or credit-skipped); cancel button; **120s stall timeout** (`STALL_MS`, sized for a real LLM scan of one large repo). |
| **done** | A **short dashboard handoff** (W6b — the old in-wizard activation checklist is gone; activation continues on the dashboard) + the invite panel (App path) + "View dashboard" / "Scan another" (`resetRun` clears the full per-run state, money snapshot included), plus the preview disclosure and any credit-shortfall notice. On a preview-then-upgrade run the banner + CTA switch to the handoff copy ("live scan is queued — open the dashboard and it starts automatically"). |

**Real vs. preview scans.** `resolveScanMode` (`scanMode.ts`) settles this before any POST, and it
now has **two** real paths:

- **Public-handle path (no installation) — REAL, free (G7-17).** `canRunRealPublicScan` returns true
  whenever there is no installation id. A token-less run can only ever read *public* repositories
  (`noAmbientToken` ⇒ a private repo 404s), which is exactly what `/report?repo=` has always scored
  for real, with no account and no credits. The client sends `publicFunnel: true` alongside
  `mock: false`; `/api/org/import` honours that flag **only** for a genuinely token-less, non-mock run
  and then meters it against the free **monthly public-scan allowance**
  (`src/lib/public-scan-quota.ts`) instead of prepaid credits — peeked up front to cap the batch
  (`notice: monthly_quota`), consumed per repo, and refunded when a repo produced nothing chargeable
  (a dedup or a degrade-to-mock). With the allowance spent the run **refuses and says so**; it never
  silently downgrades to a preview.
  *Why this mattered:* the highest-intent first run in the funnel used to show deterministic numbers
  no model produced — and those rows land in the public corpus that the
  [public register](../reporting/report.md#the-public-register--org-scorecards-g7-05--g7-06) ranks.
- **App path — real when credits allow.** Unchanged: `canRunRealScan` requires an installation *and*
  a credit read that settles with headroom. Everything else is a disclosed **preview** (deterministic
  mock), so a credit-less org never dead-ends on a 402. The gate awaits the in-flight balance read and
  retries once, then fails closed to a preview and records *why* (`previewCause`), so the done screen
  can say "balance unreadable" rather than "install the App" to an org that already did.

**Cost disclosure + the autoscan opt-in (App path only).** `ScanCostDisclosure`
(`OnboardingSelectStep.CostDisclosure.tsx`) sits directly under the Scan button and prices *both*
halves of the commitment:

- **Now** — the click scans every selected repo immediately, and a metered import reserves **one
  prepaid credit per repo** (`reserveScanCredit`) beyond the org's remaining free monthly scans
  (within-allowance scans are charged to the allowance and debit nothing). Shown as "this scan draws
  up to *N* credits now", or "covered by your free monthly scans" when the allowance absorbs it.
  `immediateScanCredits` (`src/components/credit/WatchCostTail.tsx`) returns `null` — and the
  fragment is omitted entirely — when the balance is unreadable (the run would be a free preview) or
  the org is unlimited, so no number is ever stated that the code can't back.
- **Recurring** — the **weekly** autoscan is **opt-in**. The checkbox is unchecked by default; until
  it's ticked the copy reads "One-time scan — no recurring autoscan is set up" and `startScan` sends
  `watch: false` **explicitly** (both `runImportScan` and `/api/org/import` default `watch` to true,
  so consent has to travel as a real `false`, not an omission). Ticking it reveals the
  `≈ N prepaid credits/month` estimate and sends `watch: true, schedule: "weekly"`.

The tick is per-run consent, not a preference: `resetRun` ("Scan another") clears it. The value lives
in a two-consumer store (`OnboardingSelectStep.watchOptIn.ts`) read by both the checkbox and
`startScan`, so the disclosed commitment and the POSTed one cannot drift.

**Fast preview first — the preview-then-upgrade choreography (W6b, App path with headroom).** A
second checkbox in the cost disclosure, **default ON** (same store pattern:
`OnboardingSelectStep.previewFirst.ts`; `resetRun` restores the default). When the money gate
resolves *real* on the App path and the toggle is on, `resolveImportPlan` (`importPlan.ts`) reroutes
the run:

1. The wizard imports the selection as an **instant mock preview** (`mock: true`, ~8s/repo — real
   pipeline, deterministic scores, disclosed as preview everywhere they render). Nothing is charged.
2. The import **watches** the repos regardless of the autoscan opt-in — the dashboard's live upgrade
   goes through `/api/org/scan`, which walks the watchlist — but with `schedule: "off"` unless the
   weekly autoscan was opted into, so watching never smuggles in a recurring draw.
3. On the stream's `result`, the wizard writes a **one-shot sessionStorage handoff flag**
   (`upgradeScan.ts`: org + exact repo set + timestamp, 15-min TTL) and the done phase becomes the
   dashboard handoff.
4. On `/org/<slug>`, the header scan button (`useOrgScanButton`, mounted by the org **layout**)
   consumes the flag on mount — removed *before* the run starts, so a refresh or StrictMode double
   effect can never re-trigger — and starts the **live scan of exactly those repos** through the
   existing header stream. The stream survives `?tab=` navigation, the header meter shows progress,
   and `persistScanReport`'s engine-aware dedup retires each mock row in place as live results land
   (`src/lib/db/scans-persist.ts`). Credits are drawn *there*, by the same server gates as a manual
   header scan (`requireOrgAccess`, `checkScanEntitlement`, per-repo reservation) — the disclosure
   under the Scan button says so while the toggle is on.

With the toggle off, the run is the pre-W6b behavior: live in the wizard, credits drawn immediately.
The public funnel and credit-less orgs never take the upgrade path (`resolveImportPlan` pins this) —
their runs are unchanged.

**Resume.** The wizard snapshots its resumable inputs (source, install id, selection) to
`sessionStorage` (`RESUME_KEY`) on every change and rehydrates on mount, re-fetching the source's
repos and re-applying the selection — a refresh or auth bounce lands back on **select**, not step
one. The snapshot wins over `?org=`; it clears once the scan is saved.

**The done phase no longer carries an activation checklist (W6b).** It used to render
`OnboardingChecklist` over a wizard-state-derived 5–6 step list (`buildChecklistSteps`, now deleted
along with its test); the wizard's job ends at the handoff, and activation continues on the
dashboard — which, since the [zero-repo wall fell](../org-dashboard/org-intelligence.md), renders
for this org even before the first live scan lands. `OnboardingChecklist` itself stays: the
[connect page](../github/github-app.md) still renders it over its own three-step funnel progress
(install → pick → first scan), with a progress bar, the first incomplete step highlighted as the
next action, and its accessibility intact (`role=progressbar`, `aria-live` announcements, per-step
focus move, keyboard nav).

The import path powers **free-tier onboarding**: it scans a whole public org without
requiring the [GitHub App](../github/github-app.md), and feeds straight into the
[org dashboard](../org-dashboard/org-intelligence.md).

### Dashboard tour (`src/components/onboarding/tour/`)

Onboarding hands off to a dashboard the user has never read, so the org layout mounts a guided
**tour drawer** on every org dashboard (`TourChecklist`, right-edge pull tab, collapsed by
default and `inert` while collapsed — it was demo-org-only until 2026-07-27). Opening it runs
`useTourEngine` over `ORG_TOUR_STEPS`: a six-step, three-chapter arc (set scope → read results →
explore modules) that redirects across org sub-pages and pins a non-blocking accent ring to each
step's `data-tour` anchor. Because the host is the **layout**, the tour survives sub-page
navigation and re-anchors on arrival.

- **Skips what an org doesn't have.** The anchor is polled on rAF for a bounded budget; if it
  never mounts the step is marked unavailable ("n/a" in the list) and the cursor steps over it in
  the current direction of travel. Real conditionals: `scan-scope` is non-personal-orgs-only, and
  `results-view` / `results-controls` exist only once the fleet rollup has data.
- **Persists per org.** Open state + step cursor live in `sessionStorage` under a per-org key
  (`tourStorage.ts`), so a hard refresh mid-tour resumes exactly where it was and two orgs never
  share a cursor. Restores are one-shot mount effects — the drawer renders inside a
  server-rendered layout, so a lazy storage read would desync hydration.
- Escape collapses the drawer; while collapsed the engine is fully inert (no navigation, no
  highlight, no key capture).

## Launch / fleet map (`src/app/launch/page.tsx`, `src/components/launch/FleetMap.tsx`)

`/launch?next=<safe-url>` is the post-OAuth entrance (the callback redirects here on first
sign-in). It renders `FleetMap` when signed in, else a `SignInNotice`.

`FleetMap` draws the user's App installations as animated **constellations** — each org a
cluster, each repo a star:

- A pulsing center **beacon** per org; stars placed by a deterministic phyllotaxis
  (sunflower) spiral.
- Star brightness/size scales with maturity score (null → faint, 100 → full + larger
  radius); lines connect the center to scanned-repo stars.
- Each constellation hydrates independently via
  `fetch(/api/app/repos?org=<login>&installation_id=<id>)`, mapping the response to
  `RepoStar[]`; skeleton stars animate while loading, with per-constellation
  loading/done/error status.
- A live fleet-wide tally (orgs / repos / scanned / avg maturity) updates as each org
  streams in.

## Key files

| File | Role |
| --- | --- |
| `src/app/onboarding/page.tsx` | Onboarding page shell (seeds from session; "welcome back" jump when the viewer already has a scanned org). |
| `src/components/onboarding/OnboardingFlow.tsx` | Four-phase pick → select → scan → done (view layer). |
| `src/components/onboarding/useOnboardingFlow.ts` | All wizard state/effects: listings, credit gate, resume snapshot, `?org=` handoff, SSE run. |
| `src/components/onboarding/OnboardingSelectStep.CostDisclosure.tsx` | Immediate + recurring cost copy and the weekly-autoscan opt-in checkbox. |
| `src/components/onboarding/OnboardingSelectStep.watchOptIn.ts` | The opt-in store shared by the checkbox and `startScan` (default **off**). |
| `src/components/onboarding/OnboardingSelectStep.previewFirst.ts` | The "fast preview first" store, same two-consumer shape (default **on**). |
| `src/components/onboarding/importPlan.ts` | Pure `{ mock, watch, schedule, upgradeAfter }` plan for one run — the whole preview-then-upgrade matrix. |
| `src/components/onboarding/upgradeScan.ts` | The one-shot, org-scoped, 15-min-TTL sessionStorage handoff the org header consumes to auto-start the live scan. |
| `src/components/onboarding/OnboardingFlow.model.ts` | Phases, `RESUME_KEY`/snapshot, caps (`MAX_LIST`/`MAX_SELECT`), `topSelection`. |
| `src/components/onboarding/OnboardingChecklist.tsx` | The checklist component — now rendered by the **connect page** only (the wizard's done phase dropped it in W6b). |
| `src/components/onboarding/tour/` | The org-dashboard tour: steps, engine, persistence, drawer. |
| `src/app/launch/page.tsx` | Post-OAuth cinematic entrance. |
| `src/components/launch/FleetMap.tsx` | Animated constellation star-map of the fleet. |

## Known gaps

- **The public funnel is allowance-bounded** (no longer preview-only, G7-17) — it runs real scans, but
  only as many as the caller's remaining free monthly public-scan allowance covers; past that it
  refuses rather than downgrading. Private repos still require the App and the
  [connect](../github/github-app.md) flow (the wizard reaches them via `loadInstallationRepos`, so
  "select is public-only" is no longer true — the *funnel* is, the *selector* isn't).
- **The public listing is bounded** — it walks at most 5 pages before giving up, so a large or
  fork-heavy account yields a recent slice (disclosed in the select step, not silently).
- **The tour's steps are fixed** — they teach the fleet dashboard; a personal workspace or an
  unscanned org sees several of them skipped rather than a tailored arc.
- **Launch needs sign-in + the App** — anonymous or unconfigured-auth visitors get a
  sign-in notice; the map is empty until installations exist.
