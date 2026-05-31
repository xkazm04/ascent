# Onboarding & launch

Two surfaces get a new user from "never scanned" to "looking at a cross-repo dashboard":
the **onboarding flow** (pick an org → select repos → scan → done) and the cinematic
**launch** page (a constellation star-map of the user's fleet, shown right after first
sign-in).

## Onboarding (`src/app/onboarding/page.tsx`, `src/components/onboarding/`)

`OnboardingFlow` is a four-phase state machine:

| Phase | What happens |
| --- | --- |
| **pick** | Enter an org/user handle (free text + preset suggestions like vercel, anthropic, openai). |
| **select** | List the org's public repos (up to 10 selectable, top-starred pre-selected); sticky action bar with "Select top 10" / "Clear". |
| **scanning** | Stream SSE from `POST /api/org/import` (`{ org, repos, mock, watch, schedule }`); show per-repo live progress (level + score or error); cancel button; 45s stall timeout. |
| **done** | Show `OnboardingChecklist` + buttons to "View dashboard" or "Scan another". |

`OnboardingChecklist` derives its five steps from **real signals** (does the session have
an installation? are repos selected? is the phase done?) — install the App, pick repos, run
a scan, set a watch schedule, view cross-repo analysis — with a progress bar and the first
incomplete step highlighted as the next action (linking to `/connect` etc.). The flow is
accessible (`role=progressbar`, `aria-live` announcements, keyboard nav).

The import path powers **free-tier onboarding**: it scans a whole public org without
requiring the [GitHub App](github-app.md), and feeds straight into the
[org dashboard](org-intelligence/README.md).

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
| `src/app/onboarding/page.tsx` | Onboarding page shell (seeds from session). |
| `src/components/onboarding/OnboardingFlow.tsx` | Four-phase pick → select → scan → done. |
| `src/components/onboarding/OnboardingChecklist.tsx` | Signal-driven activation checklist. |
| `src/app/launch/page.tsx` | Post-OAuth cinematic entrance. |
| `src/components/launch/FleetMap.tsx` | Animated constellation star-map of the fleet. |

## Known gaps

- **Onboarding select is public-repo only** — private repos require the App and the
  [connect](github-app.md) flow.
- **Launch needs sign-in + the App** — anonymous or unconfigured-auth visitors get a
  sign-in notice; the map is empty until installations exist.
