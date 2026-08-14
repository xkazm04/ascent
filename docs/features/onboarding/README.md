# Onboarding, Shell & AI Standard

First-run experience, the app shell, and the AI-native standard ascent both
measures against and generates.

Context-map group: **Onboarding, Shell & AI Standard** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [wizard.md](wizard.md) | First-run wizard: pick → select → scanning → done, tour, FleetMap | STALE: incomplete, not wrong |
| [ai-manifest-spec.md](ai-manifest-spec.md) | `.ai/manifest.yaml` spec v0.1.0 + doctor conformance checks | CURRENT |

## Implementation roots

- `src/components/onboarding/**`, `src/app/onboarding`: the wizard
- `src/lib/standard/**` (`manifest.ts`, `types.ts`, `doctor.ts`): AI manifest + conformance
- `src/lib/onboarding/**`, `src/app/api/report/skill`, `src/app/api/report/foundation/pr`
- `src/app/launch`, `src/components/launch`: Launch Fleet Map
- `src/app/connect`, `src/components/connect`: repo selection
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
