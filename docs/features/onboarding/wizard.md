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
| **select** | Up to 10 selectable. The public listing is ordered most-recently-pushed and discloses when it was cut short (`truncated`); the App listing is ordered by stars → recent activity. Preselection is by prominence (stars, then recency) in both. Sticky action bar with "Select top 10" / "Clear", plus the recurring-cost disclosure (a scan enrolls each repo in the **weekly** watch on the App path). |
| **scanning** | Stream SSE from `POST /api/org/import` (`{ org, repos, mock, watch, schedule }`); per-repo live progress (level + score, error, or credit-skipped); cancel button; **120s stall timeout** (`STALL_MS`, sized for a real LLM scan of one large repo). |
| **done** | `OnboardingChecklist` + "View dashboard" / "Scan another" (`resetRun` clears the full per-run state, money snapshot included), plus the preview disclosure and any credit-shortfall notice. |

**Real vs. preview scans.** A run is real only on the App path *and* when the org's credit read
settles with headroom (`canRunReal`); everything else — the whole public-handle funnel — is a
disclosed **preview** (deterministic mock), so a credit-less org never dead-ends on a 402 and
mock scores are never mistaken for live ones. The gate awaits the in-flight balance read and
retries once, then fails closed to a preview and records *why* (`previewCause`), so the done
screen can say "balance unreadable" rather than "install the App" to an org that already did.

**Resume.** The wizard snapshots its resumable inputs (source, install id, selection) to
`sessionStorage` (`RESUME_KEY`) on every change and rehydrates on mount, re-fetching the source's
repos and re-applying the selection — a refresh or auth bounce lands back on **select**, not step
one. The snapshot wins over `?org=`; it clears once the scan is saved.

`OnboardingChecklist` derives its steps from **real signals** (does the session have an
installation? are repos selected? is the phase done? was the run on the App path?) — install the
App, pick repos, run a scan, set a watch schedule, *invite your team* (App path only, so the list
is **5 or 6 steps**), view cross-repo analysis — with a progress bar and the first incomplete step
highlighted as the next action (linking to `/connect` etc.). "Set a watch schedule" ticks only on
the App path, because that's the only path whose import actually enrolls a watch. The flow is
accessible (`role=progressbar`, `aria-live` announcements, per-step focus move, keyboard nav).

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
| `src/components/onboarding/OnboardingFlow.model.ts` | Phases, `RESUME_KEY`/snapshot, caps (`MAX_LIST`/`MAX_SELECT`), `topSelection`, checklist builder. |
| `src/components/onboarding/OnboardingChecklist.tsx` | Signal-driven activation checklist (5–6 conditional steps). |
| `src/components/onboarding/tour/` | The org-dashboard tour: steps, engine, persistence, drawer. |
| `src/app/launch/page.tsx` | Post-OAuth cinematic entrance. |
| `src/components/launch/FleetMap.tsx` | Animated constellation star-map of the fleet. |

## Known gaps

- **The public funnel is preview-only** — a real (LLM) scan needs the App path *and* credits;
  the public-handle path always produces a disclosed mock. Private repos likewise require the
  App and the [connect](../github/github-app.md) flow (the wizard reaches them via `loadInstallationRepos`,
  so "select is public-only" is no longer true — the *funnel* is, the *selector* isn't).
- **The public listing is bounded** — it walks at most 5 pages before giving up, so a large or
  fork-heavy account yields a recent slice (disclosed in the select step, not silently).
- **The tour's steps are fixed** — they teach the fleet dashboard; a personal workspace or an
  unscanned org sees several of them skipped rather than a tailored arc.
- **Launch needs sign-in + the App** — anonymous or unconfigured-auth visitors get a
  sign-in notice; the map is empty until installations exist.
