# Onboarding, Shell & AI Standard

First-run experience, the app shell, and the AI-native standard ascent both
measures against and generates.

Context-map group: **Onboarding, Shell & AI Standard** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [wizard.md](wizard.md) | First-run wizard: pick → select → scanning → done, tour, FleetMap | STALE: incomplete, not wrong |
| [ai-manifest-spec.md](ai-manifest-spec.md) | `.ai/manifest.yaml` spec v0.3.0 + doctor conformance checks + the read-back contract | CURRENT |

## Implementation roots

- `src/components/onboarding/**`, `src/app/onboarding`: the wizard
- `src/lib/standard/**` (`manifest.ts`, `types.ts`, `doctor.ts`): AI manifest + conformance
- `src/lib/onboarding/**`, `src/app/api/report/skill`, `src/app/api/report/foundation/pr`

### Two deliveries of the `.ai/` foundation, one generator (2026-08-28)

`buildFoundation(report)` (`src/lib/standard/index.ts`) produces the tree and is the only place it is
produced. Two doors deliver it, differing *only* in delivery:

| door | delivery | where |
| --- | --- | --- |
| `POST /api/report/foundation/pr` → `openFoundationPr` | one draft PR on `ascent/ai-foundation`, via the GitHub App token | cloud + self-hosted; offered from the per-repo report header |
| the improvement loop's **foundation lane** (`src/lib/local/lane-install.ts`) | files written into the run's isolated worktree and committed, then rescanned | local mode only |

Both refuse to overwrite a file the repo already owns, and both treat a pre-existing
`.ai/manifest.yaml` as *already installed*. `lane-install.test.ts` drives both off one report and
asserts the bytes are identical — that parity is a test, not a comment. Rule, execution and cloud
parity: [org-planning/live.md § Lane kinds](../org-planning/live.md#lane-kinds-foundation-and-practice-lanes-2026-08-28).

> Deliberately documented here and not in `ai-manifest-spec.md`: that file is embedded verbatim into
> `src/lib/standard/spec.ts` and ships to every adopting repo as `.ai/SPEC.md`, so a section about
> Ascent's own install plumbing does not belong in it (`standard.test.ts` asserts the two are
> byte-identical, which is how this was caught).
- `src/app/launch`, `src/components/launch`: Launch Fleet Map
- `src/lib/first-run.ts`: the cloud / self-hosted first-run resolver the page and the landing branch on (the `/connect` page was retired 2026-08-29; its jobs live in `src/components/onboarding/`)
- `src/app/layout.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `robots.ts`: shell/SEO
- `src/app/_dev-inspector`, `src/lib/dev`: Dev Inspector

## Known gaps

- `wizard.md`'s key-files table omits five shipped sub-flows in the same directory:
  `scanGate.ts` + `OnboardingGateStep.tsx` (access-gate step for 401/403 refusals
  with sign-in CTA and resume round-trip), `personalWatch.ts` +
  `OnboardingGatePersonal.tsx` (personal-workspace gate),
  `OnboardingInvitePanel.tsx` (invite-teammates panel with per-repo retry),
  `retryRepo.ts`, and `scanMode.ts`.
- **Undocumented areas in this group:** the App Shell / SEO / error-page surface,
  the Launch Fleet Map, Connect & Repo Selection, and the Dev Inspector have no
  doc of their own; only the source roots listed above cover them.
