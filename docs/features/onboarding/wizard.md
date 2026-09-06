# Onboarding & launch

Two surfaces get a new user from "never scanned" to "looking at a cross-repo dashboard":
the **onboarding flow** (pick an org → select repos → scan → done) and the cinematic
**launch** page (a constellation star-map of the user's fleet, shown right after first
sign-in).

## The first-run door is mode-aware (2026-08-29)

`/onboarding` is the ONE first-run destination — every "scan your org" CTA (landing hero and fleet
section, `/about`, `/about-org`, the org-shell walls, the fleet-map empty state, the report
conversion CTA, the header sign-in `next`, `safeNext()`'s fallback, `/me` and `/launch` bounces)
lands here. The retired `/connect` page's jobs live here too (see
[github-app.md](../github/github-app.md#install-entry-the-connect-page-is-retired-2026-08-29)):
`OnboardingErrorBanner` renders every `?error=` / `?resynced=` / `?revoked=` code the auth and App
routes emit, `SessionControls` carries the dormant session's re-sync / revoke-others controls,
`ScanPrivacyNotice` the "where your code goes" disclosure, and the wizard's access gate carries the
GitHub App install link (`installUrl` prop). `next.config.ts` redirects `/connect` → `/onboarding`.

What the page shows first is decided server-side by `resolveFirstRun()` (`src/lib/first-run.ts`),
keyed on `selfHosted()`:

| Deployment | Signed out, wall on | Nothing set up | Otherwise |
| --- | --- | --- | --- |
| **Cloud** | `FirstRunSignIn` (cloud): a "Sign in with GitHub" panel ABOVE the wizard — the pitch is identity, the public path stays reachable beneath it | n/a (the wizard creates tenants) | the wizard |
| **Self-hosted** | `SignInNotice` only — a wall to pass, nothing to sell | `SelfHostSetupPanel`: the `/onboarding` **skill** guide (run from Claude Code in the clone), with `?wizard=1` one click away for "just score a public org" | the wizard |

"Nothing set up" (`resolveFirstRunSetup`, pure + tested) means: no `ASCENT_LOCAL_ORG` declared, no
GitHub App configured, and no `Organization` row beyond the shared `public` corpus
(`countTenantOrgs()`, `src/lib/db/tenants.ts`). The landing page reads the same resolver: on a
self-hosted install the hero's "Open source · run it yourself" CTA is replaced by "Finish setup ·
/onboarding" while unset (and by nothing once set), and the fleet section's secondary link reads
"set this install up first" instead of "sign in with GitHub first".

The skill's step list the panel renders is the same data the self-hosted `/pricing` renders
(`src/components/pricing/selfHostPricingData.ts`), so the two surfaces can't describe two skills.

## Onboarding (`src/app/onboarding/page.tsx`, `src/components/onboarding/`)

`OnboardingFlow` is a four-phase state machine; all of its state, effects and handlers live in
the co-located `useOnboardingFlow` hook (the component is the view layer).

| Phase | What happens |
| --- | --- |
| **pick** | Choose a source: a GitHub **App installation** (private repos included, via `/api/app/repos`), a discovered/suggested org chip, or a free-text org/user handle (public listing, via `/api/org/repos`). A `?org=<handle>` query param (the `/api/app/setup` post-install bounce, and any deep link that already knows the account) starts the public path immediately. |
| **select** | Up to 10 selectable. The public listing is ordered most-recently-pushed and discloses when it was cut short (`truncated`); the App listing is ordered by stars → recent activity. Preselection is by prominence (stars, then recency) in both. Sticky action bar with "Select top 10" / "Clear", plus the cost disclosure + autoscan **opt-in** (see below). |
| **scanning** | Stream SSE from `POST /api/org/import` (`{ org, repos, mock, watch, schedule }`); per-repo live progress (level + score, error, or credit-skipped); cancel button; **360s stall timeout** (`STALL_MS`, sized above one real LLM assessment — see below). |
| **done** | A **short dashboard handoff** + the **foundation install panel** and the invite panel (both App path only) + "View dashboard" / "Scan another" (`resetRun` clears the full per-run state, money snapshot included), plus the preview disclosure and any credit-shortfall notice. On a preview-then-upgrade run the banner + CTA switch to the handoff copy ("live scan is queued: open the dashboard and it starts automatically"). |

**Real vs. preview scans.** `resolveScanMode` (`scanMode.ts`) settles this before any POST, and it
now has **two** real paths:

- **Public-handle path (no installation): REAL, free (G7-17).** `canRunRealPublicScan` returns true
  whenever there is no installation id. A token-less run can only ever read *public* repositories
  (`noAmbientToken` ⇒ a private repo 404s), which is exactly what `/report?repo=` has always scored
  for real, with no account and no credits. The client sends `publicFunnel: true` alongside
  `mock: false`; `/api/org/import` honours that flag **only** for a genuinely token-less, non-mock run
  and then meters it against the free **monthly public-scan allowance**
  (`src/lib/public-scan-quota.ts`) instead of prepaid credits, peeked up front to cap the batch
  (`notice: monthly_quota`), consumed per repo, and refunded when a repo produced nothing chargeable
  (a dedup or a degrade-to-mock). With the allowance spent the run **refuses and says so**; it never
  silently downgrades to a preview.
  *Why this mattered:* the highest-intent first run in the funnel used to show deterministic numbers
  no model produced. Those rows land in the public corpus that the
  [public register](../reporting/report.md#the-public-register--org-scorecards-g7-05--g7-06) ranks.
- **App path: real when credits allow.** Unchanged: `canRunRealScan` requires an installation *and*
  a credit read that settles with headroom. Everything else is a disclosed **preview** (deterministic
  mock), so a credit-less org never dead-ends on a 402. The gate awaits the in-flight balance read and
  retries once, then fails closed to a preview and records *why* (`previewCause`), so the done screen
  can say "balance unreadable" rather than "install the App" to an org that already did.

**Cost disclosure + the autoscan opt-in (App path only).** `ScanCostDisclosure`
(`OnboardingSelectStep.CostDisclosure.tsx`) sits directly under the Scan button and prices *both*
halves of the commitment:

- **Now**: the click scans every selected repo immediately, and a metered import reserves **one
  prepaid credit per repo** (`reserveScanCredit`) beyond the org's remaining free monthly scans
  (within-allowance scans are charged to the allowance and debit nothing). Shown as "this scan draws
  up to *N* credits now", or "covered by your free monthly scans" when the allowance absorbs it.
  `immediateScanCredits` (`src/components/credit/WatchCostTail.tsx`) returns `null` (and the
  fragment is omitted entirely) when the balance is unreadable (the run would be a free preview) or
  the org is unlimited, so no number is ever stated that the code can't back.
- **Recurring**: the **weekly** autoscan is **opt-in**. The checkbox is unchecked by default; until
  it's ticked the copy reads "One-time scan: no recurring autoscan is set up" and `startScan` sends
  `watch: false` **explicitly** (both `runImportScan` and `/api/org/import` default `watch` to true,
  so consent has to travel as a real `false`, not an omission). Ticking it reveals the
  `≈ N prepaid credits/month` estimate and sends `watch: true, schedule: "weekly"`.

The tick is per-run consent, not a preference: `resetRun` ("Scan another") clears it. The value lives
in a two-consumer store (`OnboardingSelectStep.watchOptIn.ts`) read by both the checkbox and
`startScan`, so the disclosed commitment and the POSTed one cannot drift.

**Fast preview first: the preview-then-upgrade choreography (W6b, App path with headroom).** A
second checkbox in the cost disclosure, **default ON** (same store pattern:
`OnboardingSelectStep.previewFirst.ts`; `resetRun` restores the default). When the money gate
resolves *real* on the App path and the toggle is on, `resolveImportPlan` (`importPlan.ts`) reroutes
the run:

1. The wizard imports the selection as an **instant mock preview** (`mock: true`, ~8s/repo, real
   pipeline, deterministic scores, disclosed as preview everywhere they render). Nothing is charged.
2. The import **watches** the repos regardless of the autoscan opt-in (the dashboard's live upgrade
   goes through `/api/org/scan`, which walks the watchlist) but with `schedule: "off"` unless the
   weekly autoscan was opted into, so watching never smuggles in a recurring draw.
3. On the stream's `result`, the wizard writes a **one-shot sessionStorage handoff flag**
   (`upgradeScan.ts`: org + exact repo set + timestamp, 15-min TTL) and the done phase becomes the
   dashboard handoff.
4. On `/org/<slug>`, the header scan button (`useOrgScanButton`, mounted by the org **layout**)
   consumes the flag on mount (removed *before* the run starts, so a refresh or StrictMode double
   effect can never re-trigger) and starts the **live scan of exactly those repos** through the
   existing header stream. The stream survives `?tab=` navigation, the header meter shows progress,
   and `persistScanReport`'s engine-aware dedup retires each mock row in place as live results land
   (`src/lib/db/scans-persist.ts`). Credits are drawn *there*, by the same server gates as a manual
   header scan (`requireOrgAccess`, `checkScanEntitlement`, per-repo reservation); the disclosure
   under the Scan button says so while the toggle is on.

With the toggle off, the run is the pre-W6b behavior: live in the wizard, credits drawn immediately.
The public funnel and credit-less orgs never take the upgrade path (`resolveImportPlan` pins this).
Their runs are unchanged.

**Resume.** The wizard snapshots its resumable inputs (source, install id, selection, and since
2026-09-05 the **phase** and the import's **`runId`**) to `sessionStorage` (`RESUME_KEY`) on every
change and rehydrates on mount, re-fetching the source's repos and re-applying the selection. A
refresh or auth bounce on the pick/select steps lands back on **select**, not step one. The snapshot
wins over `?org=`; it clears once the scan is saved.

**A refresh mid-scan re-attaches instead of re-running (2026-09-05).** The import stream is not
the run: `mapPool` in `POST /api/org/import` outlives the request, so a closed tab keeps scanning
and spending. The route now announces its `runId` on an opening `queued` frame and again on
`result` (the same frame shape as `/api/org/scan`). A snapshot taken while `phase === "scanning"`
carries that id, and rehydrating from it re-enters the scan step in a **Reconnected** state
(`OnboardingReconnected.tsx`): `useImportReattach` polls the already-gated
`GET /api/org/scan/queue?org=&runId=` on the same cadence the org scan button uses, folds job
states into the rows (a finished job renders as "scanned, open the report", never with a
fabricated level), and shows the done screen once nothing is pending. Rows the run never reported
resolve to "not scanned". If the follow itself is refused (no database, no access) the notice says
the run may still be going and points at the dashboard rather than claiming it finished. A
`beforeunload` guard is armed while scanning.

**Retry carries the same consent as the batch (2026-09-05).** The per-row Retry used to post only
`{ org, repos, installationId, mock }`, so `watch` defaulted to true on the App path and re-enrolled
the repo in the weekly billable autoscan the user had declined, and the missing `publicFunnel` made a
free-funnel retry metered. It now resolves the same plan the batch did (`resolveImportPlan` over the
preview-first and autoscan opt-in stores plus `resolveScanMode`) and posts `watch`, `schedule` and
`publicFunnel` explicitly.

**Skip reasons are the server's, not "out of credits" (2026-09-05).** The stream deferred a repo
for one of three reasons (`insufficient_credits`, `monthly_quota`, `in_progress`) and every one
rendered as "out of credits"; leftovers the stream never named were relabelled as credits too. Each
reason now has its own row label and done-screen banner (`skipReason.ts`,
`OnboardingSkipNotices.tsx`); leftovers take the reason of the last capping notice, else the neutral
"not scanned"; `too_many_repos` and `listing_truncated` notices are surfaced instead of dropped.

**The scan step states how long it will take (2026-09-05).** `scanExpectation.ts` derives "Usually
about N min for M repositories, 4 at a time" from the report's own calibration constants in
`scanEstimate.ts` and the route's real `SCAN_CONCURRENCY` (`ceil(repos / 4)` waves), so the wizard
carries no second number. While the provider is unresolved it says "Up to …" (the slowest ceiling,
the report's backstop rule); the line waits for the run mode to resolve so it never prints a number
that then grows, and it is suppressed on the reconnected and done states. In-flight rows read
"scanning now" with a motion-safe accent dot; queued rows read "queued". The route emits no
`started` frame, so in-flight is inferred from `mapPool`'s index-order lane discipline; a `started`
frame would make it exact.

**The done phase carries one INSTALLABLE step, not an activation checklist (moonshot #35).** W6b
deleted the wizard-state-derived 5–6 step list (`buildChecklistSteps`, gone with its test) because it
duplicated the dashboard. What replaced it is narrower and does real work: `FoundationPanel`
(`OnboardingFoundationPanel.tsx`) offers **one click that opens a draft PR in every repo that just
scanned successfully**, seeding the `.ai/` foundation Ascent generated from each scan
(`POST /api/report/foundation/pr-batch`). It renders on the App path only (`foundationOrg`, gated the
same way as the invite panel: an installation id means a real org with a token behind it), offers a
no-op **Skip**, and discloses before sending — that the PR is a draft nobody merges for you, and that
report-back (the two Actions secrets and the `Secrets: write` permission they need) is *described*
here but performed on the Repositories tab, behind a typed confirmation and the owner role. A repo
that errored or was credit-skipped is excluded: it has no saved scan, so no foundation can be
generated for it. Everything else on the done screen still hands off to the dashboard.
`OnboardingChecklist` itself stays: the
[connect page](../github/github-app.md) still renders it over its own three-step funnel progress
(install → pick → first scan), with a progress bar, the first incomplete step highlighted as the
next action, and its accessibility intact (`role=progressbar`, `aria-live` announcements, per-step
focus move, keyboard nav).

The import path powers **free-tier onboarding**: it scans a whole public org without
requiring the [GitHub App](../github/github-app.md), and feeds straight into the
[org dashboard](../org-dashboard/org-intelligence.md).

### The onboarding companion (`src/components/onboarding/tour/`)

**Ascent runs ONE guidance channel on the org dashboard.** The right-edge drawer the layout mounts
(`TourChecklist`, pull tab, `inert` while collapsed) used to hold a fixed six-step teach arc; since
W6c it holds the **server-derived getting-started checklist**, and the teach steps are demoted to
spotlight copy the tasks borrow. A second "activation" surface next to it would have split the one
question a new member has ("what do I do next?") across two answers that could disagree.

**Three postures. Two are derived from the caller's own stamp** (`decidePosture`, `tasks.ts`); the
third is an explicit choice layered over them (`resolveDrawerPosture`):

| | `companion` | `teaching` | `athena` |
| --- | --- | --- | --- |
| Who | a member whose `onboarding` stamp is null and who still has an available undone step | stamped (completed **or** skipped), `allDone`, the demo org, or anyone with no membership row | anyone who pressed **Athena** in the drawer header (not offered on the demo org) |
| Entry | the drawer **opens itself** | collapsed pull tab, discoverable (today's behaviour exactly) | never opens itself — an explicit switch |
| Body | ONE promoted next task (primary CTA + "Show me") over the full task rail | task rail + the "Learn the dashboard" teach rail | the conversation surface ([companion](../companion/README.md)) |
| Footer | "Skip setup" (stamps) | — | the composer |

**`companion` is not Athena, and the name predates her.** It means "the onboarding drawer opened
itself", and it is load-bearing in `TourChecklist`, `TourNextTask`, `useGettingStarted` and
`useTourEngine` — so the absorb added a distinct `athena` value beside it rather than a rename that
would have silently re-aimed all four.

**The checklist model is UNCHANGED by the absorb.** `buildGettingStartedModel`,
`GETTING_STARTED_ANCHORS` and every `data-tour` anchor are read, never rewritten: Athena becomes the
checklist's *voice* (`restingLine` is handed the step `nextTask` already promoted) and never a second
opinion about what is left to do. Two surfaces disagreeing about whether the first scan has run is
worse than either alone.

**The channel choice is not persisted, deliberately.** `TourStorageState` is the obvious home for it,
but `useTourEngine.dom.test.tsx:184`/`:202` assert the stored record deep-equals `{ open, index }`.
The drawer lives in the org *layout*, so the channel and the conversation in it already survive every
`?tab=` switch; only a hard reload returns to the checklist, and a reload re-boots the transcript from
the server anyway.

A stored session decision always wins over the posture, so a member who shut the companion is not
re-opened on every navigation. **Collapsing is not skipping**: Escape and the collapse control stay
pure UI state; only "Skip setup" writes.

- **Doneness is the server's, never the drawer's.** `useGettingStarted` polls
  `GET /api/org/getting-started` every 20s (skipping hidden tabs), so a scan finishing in another
  tab, a rec assigned from the backlog tab, or a teammate accepting an invite all tick a row with no
  click in here. Progress is `done/total` over **available** steps only.
- **Unavailable steps render honestly**: the same dashed-marker / "n/a" treatment the teach list
  used, plus the reason ("Invites are owner-only"). A personal workspace therefore sees a genuinely
  shorter list (3 steps) rather than a mostly-disabled one.
- **Tasks map to spotlights, reusing the engine.** Each task deep-links to the tab the API names
  (`orgTabHref`) and highlights the `data-tour` anchor it names: `backlog-recs`, `skills-registry`,
  `watch-schedule`, `invite-member` are stamped on the real controls (BacklogPanel, SkillsPanel,
  ScheduleSelect, MemberInvites). Where a teach step is the honest partner it lends its copy: the
  undone `first-scan` task spotlights `scan-scope` (the control that *makes* the baseline; the
  results grid doesn't exist yet) and switches to `results-view` once done; `loop` borrows
  "Choose what's in scope". The three teach steps no task claims stay reachable in the teaching rail.
  **W1a (2026-08-14):** the `modules-nav` teach step ("The rail is the journey") now names the five
  journey sections: Standing · Shared · In flight · Bought · Admin, instead of the retired
  data-type modules. Teach copy describes the shipping rail, so a regroup edits it in lockstep; see
  [org-intelligence.md](../org-dashboard/org-intelligence.md#the-rail-is-grouped-by-the-journey-not-by-data-type-w1a-2026-08-14).
- **A sixth step: name the programme (W1c, 2026-08-14).** The checklist used to end at "invite a
  teammate", exactly where the actual job starts. The `program` step (phase `program`, tab `plan`,
  anchor `transition-program`) is done when the org has a `TransitionProgram` row, and completing it
  is what makes the shell's programme strip appear on every tab from then on. Member-gated and
  org-only: a personal workspace has no fleet to run a programme over and no Plan tab in its subset.
  Model + frozen-baseline contract:
  [org-intelligence.md](../org-dashboard/org-intelligence.md#the-transition-programme-w1c-2026-08-14).
- **A missing anchor degrades to plain navigation.** The engine polls on rAF for a bounded budget and
  marks the step skipped; in the drawer, auto-advance is OFF (`autoAdvanceOverSkipped: false`), because the
  member asked for *this* task, so the tab switch stands and only the ring is missing. Never a stuck
  "seeking" state, and never a silent jump to a different task.
- **Both stamps are written from here.** "Skip setup" POSTs `{status:"skipped"}`; reaching `allDone`
  POSTs `{status:"completed"}` once (one-shot ref, fire-and-forget; a failed stamp never blocks the
  UI, it just lets the companion open once more).
- **Persists per org.** The drawer owns `open`, the engine owns the cursor, in one `sessionStorage`
  record patched by both (`tourStorage.ts`). Restores are one-shot mount effects: the drawer renders
  inside a server-rendered layout, so a lazy storage read would desync hydration; the drawer's
  snapshot is taken *before* the engine's persist effect, or a fresh mount would always look like the
  member had already collapsed it.
- The engine addresses **tabs**, not sub-paths (`TourStep.tab`): every org surface lives in the
  `?tab=` shell and the old sub-paths are permanent redirect stubs, which a pathname comparison could
  never settle on.

### Server-side onboarding model (W6a: stamp + derived getting-started)

The backend for the next-generation onboarding channel (the tour drawer evolves into a task
checklist in a later lane) ships as two primitives, both deliberately server-owned:

- **The gate is a stamp, not an empty-data heuristic.** `Membership.onboardingCompletedAt` /
  `onboardingSkippedAt`: either one, once set, silences the guided flow for that member in that
  org forever (an org whose data later empties out must not re-trigger onboarding). Self-scoped
  like the alerts watermark: `POST /api/org/onboarding { org, status: "completed"|"skipped" }`
  stamps the *caller's own* membership row (viewer-gated tenant wall, same-origin enforced, not
  audit-logged, which is the norm for self-scoped read-state stamps). The add-column migration backfilled
  every pre-existing membership as completed, so only new memberships see the flow.
  `npm run dev:empty` (fresh memberships) fires it naturally.
- **Step doneness is derived from real data, never recorded per step.**
  `GET /api/org/getting-started?org=` (member-gated, polling-safe) serves eight typed steps
  mirroring the onboarding narrative: `first-scan` (≥1 persisted scan; personal: a watched
  pointer), `gap-engaged` (rec assigned/done, ImprovementPr, or a personal overlay), `registry`
  (≥1 live OrgSkill/OrgMemory), **`foundation`** (≥1 `foundation.pr_opened` audit row — either
  door, single-repo or batch, writes it), **`conformance`** (≥1 repo with a non-null
  `aiConformance`; non-null and NOT `> 0`, because a repo that honestly scored 0% has still closed
  the loop), `loop` (≥2 of watch schedule · alerts webhook · published AI stance), `team` (≥2
  members or a pending invite), each with `{ done, available, tab, anchor }`
  plus an `allDone` rollup over *available* steps and the caller's own stamp. `available` renders
  honestly: personal workspaces lose the fleet `foundation`/`conformance`/`loop`/`team` steps (no
  installation token, no fleet), and a role below the step's write gate (member/admin/owner) sees it
  unavailable instead of a 403. The two fleet-install steps sit **after `registry` and before
  `loop`**, which is the real dependency order — the fleet has to carry the standard before a doctor
  run can report anything, and there is nothing to instrument on a cadence until something reports.
  Both are admin-gated and anchored on the Repositories tab's rollout panel
  (`foundation-rollout`, `conformance-reported`). Derivation:
  `src/lib/org/getting-started.ts` (pure model) over `getGettingStartedFacts`
  (`src/lib/db/org-onboarding.ts`, one pass of existence-shaped lookups). Anchors are shared
  constants (`GETTING_STARTED_ANCHORS`), all now stamped on real controls and consumed by the
  companion above.

## Launch / fleet map (`src/app/launch/page.tsx`, `src/components/launch/FleetMap.tsx`)

`/launch?next=<safe-url>` is the post-OAuth entrance (the callback redirects here on first
sign-in). It renders `FleetMap` when signed in, else a `SignInNotice`.

`FleetMap` draws the user's App installations as animated **constellations**, each org a
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
| `src/app/onboarding/page.tsx` | Onboarding page shell: mode-aware first screen (see above), `?error=` banners, seeds from session; "welcome back" jump when the viewer already has a scanned org. |
| `src/lib/first-run.ts` | `resolveFirstRun()` — cloud vs self-hosted, auth backend, wall, signed-in, and the pure `resolveFirstRunSetup()` verdict (tested). |
| `src/components/onboarding/FirstRunSignIn.tsx` | Cloud: the sign-in-first panel above the wizard. Self-hosted: the plain `SignInNotice`. |
| `src/components/onboarding/SelfHostSetupPanel.tsx` | Self-hosted + nothing set up: the `/onboarding` skill guide (steps from `selfHostPricingData.ts`). |
| `src/components/onboarding/OnboardingErrorBanner.tsx` | `ONBOARDING_ERROR_COPY` + the `?error=` / `?resynced=` / `?revoked=` banners (ex-`/connect`). |
| `src/components/onboarding/SessionControls.tsx` | Dormant-session re-sync + "sign out everywhere else" (ex-`/connect`). |
| `src/components/onboarding/PrivacyNotice.tsx` | `ScanPrivacyNotice` — where a private scan's sampled files go (ex-`/connect`). |
| `src/components/onboarding/OnboardingFlow.tsx` | Four-phase pick → select → scan → done (view layer). |
| `src/components/onboarding/useOnboardingFlow.ts` | All wizard state/effects: listings, credit gate, resume snapshot, `?org=` handoff, SSE run. |
| `src/components/onboarding/OnboardingSelectStep.CostDisclosure.tsx` | Immediate + recurring cost copy and the weekly-autoscan opt-in checkbox. |
| `src/components/onboarding/OnboardingSelectStep.watchOptIn.ts` | The opt-in store shared by the checkbox and `startScan` (default **off**). |
| `src/components/onboarding/OnboardingSelectStep.previewFirst.ts` | The "fast preview first" store, same two-consumer shape (default **on**). |
| `src/components/onboarding/importPlan.ts` | Pure `{ mock, watch, schedule, upgradeAfter }` plan for one run: the whole preview-then-upgrade matrix. |
| `src/components/onboarding/upgradeScan.ts` | The one-shot, org-scoped, 15-min-TTL sessionStorage handoff the org header consumes to auto-start the live scan. |
| `src/components/onboarding/OnboardingFlow.model.ts` | Phases, `RESUME_KEY`/snapshot, caps (`MAX_LIST`/`MAX_SELECT`), `topSelection`. |
| `src/components/onboarding/tour/TourChecklist.tsx` | The drawer: chrome, posture, channel switch, both stamp writes. |
| `src/components/onboarding/tour/TourDrawerHeader.tsx` | Header row + the Setup/Athena channel switch (`aria-pressed`, never `aria-expanded` — the pull tab owns that). |
| `src/components/onboarding/tour/TourChecklistBody.tsx` | The setup channel's scrolling body: progress, promoted task, both rails. |
| `src/components/onboarding/tour/TourStepFooter.tsx` | The setup channel's footer: running spotlight copy, "Skip setup", "Got it". |
| `src/components/onboarding/tour/tasks.ts` | Pure content model: rows, progress, next task, posture, spotlight mapping. |
| `src/components/onboarding/tour/useGettingStarted.ts` | Poll the derived checklist; POST the stamp. |
| `src/components/onboarding/tour/useTourEngine.ts` | Cursor, tab deep-link, rAF anchor poll, skip-when-absent, cursor persistence. |
| `src/components/onboarding/tour/steps.ts` | The teach library the tasks borrow spotlight copy from. |
| `src/lib/org/getting-started.ts` | Pure getting-started model: derived steps, availability honesty, `allDone`. |
| `src/lib/db/org-onboarding.ts` | Membership onboarding stamp read/write + one-pass getting-started facts. |
| `src/app/api/org/onboarding/route.ts` | `POST` the caller's own completed/skipped stamp (the flow gate). |
| `src/app/api/org/getting-started/route.ts` | `GET` the derived checklist + the caller's stamp (polling-safe). |
| `src/app/launch/page.tsx` | Post-OAuth cinematic entrance. |
| `src/components/launch/FleetMap.tsx` | Animated constellation star-map of the fleet. |

## The stall watchdog and why it is 360s

Nothing is emitted between one repo's `repo` event and the next, so `STALL_MS` must exceed the time a
**single** assessment takes or the watchdog kills healthy scans.

It was 120s, and that was under the real number. A measured `claude-opus-5` assessment of
`vercel/sandbox` takes ~177s, so on a live provider the watchdog fired mid-scan: the client aborted,
showed *"The scan stalled (no response). Please try again."*, and dropped back to repo selection —
while the server ran to completion, wrote the scans, and **consumed the org's allowance**. The user was
told it failed, invited to retry, and charged for the run that had actually succeeded.

A client-side abort does not stop the server, which is why the two halves disagreed so completely. The
bug was invisible to a mock engine (mock scans return in milliseconds) and surfaced only once the org
e2e suite was pointed at a live provider.

360s is ~2× the measured worst single assessment: still bounded, so a genuinely dead stream stays
recoverable rather than hanging forever. The real fix is server-side heartbeat frames the watchdog can
track, which would let this drop back to seconds.

## Known gaps

- **No SSE heartbeat.** The stall watchdog can only measure the gap between *meaningful* events, so its
  window is set by the slowest single assessment rather than by liveness. A dead stream is therefore
  detected in 360s, not in seconds, and a model slower than ~6 minutes per repo would still false-abort.
- **The public funnel is allowance-bounded** (no longer preview-only, G7-17): it runs real scans, but
  only as many as the caller's remaining free monthly public-scan allowance covers; past that it
  refuses rather than downgrading. Private repos still require the App and the
  [install entry](../github/github-app.md) (the wizard reaches them via `loadInstallationRepos`, so
  "select is public-only" is no longer true; the *funnel* is, the *selector* isn't).
- **The public listing is bounded**: it walks at most 5 pages before giving up, so a large or
  fork-heavy account yields a recent slice (disclosed in the select step, not silently).
- **Launch needs sign-in + the App**: anonymous or unconfigured-auth visitors get a
  sign-in notice; the map is empty until installations exist.
