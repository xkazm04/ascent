# Feature Scout — First-Run Onboarding Wizard (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. First scan is always mock — onboarding shows fake maturity scores
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/onboarding/importScan.ts:63
- **Scenario**: A new user signs in, picks their real org's repos, watches the scan complete, and reads the "L3 · 62" scores as the truth about their codebases — then makes a judgment about the product's accuracy on that basis.
- **Gap**: The onboarding POST hardcodes `mock: true` (confirmed: only occurrence in `src/components/onboarding`, no UI toggle). The import route (`src/app/api/org/import/route.ts:107-126`) fully supports real-LLM scans, credit metering, and entitlement gating — but onboarding never reaches it. The single highest-stakes activation moment ("see your maturity scores", `OnboardingScanStep.tsx:52`) presents fabricated numbers with no disclosure that they are mock. There is no "run a real scan" path anywhere in the wizard.
- **Impact**: Every user; this is the activation→conversion hinge. A demo-quality fake first impression either misleads (user trusts wrong scores) or, once discovered, destroys trust. Real first scans are the product's core value and the reason to buy credits.
- **Fix sketch**: Add a `mock` field to `ImportScanRequest` and thread it from a SelectStep choice. On the App/owned-org path, default to `mock:false` (the route already gates credits + entitlement and refunds on failure); keep `mock:true` only for the anonymous public-handle funnel. Add a one-line "preview vs. real scan" disclosure on the select step beside the existing credit estimate. ~0.5 day.

## 2. No resumability — refresh, navigation, or auth bounce drops the user to step one
- **Severity**: High
- **Category**: user_benefit
- **File**: src/components/onboarding/OnboardingFlow.tsx:50-66
- **Scenario**: A user picks an org, selects 8 repos, then a scan stalls (the 45s watchdog fires, `importScan.ts:5`) or they accidentally refresh / click a checklist link to `/connect` and come back. Everything resets to the empty "pick" phase; selections and progress are gone.
- **Gap**: All wizard state (`phase`, `org`, `selected`, `rows`, `sourceInstallId`) lives in component `useState` with zero persistence — grep confirms no localStorage/sessionStorage/cookie anywhere in `src/components/onboarding` or `src/app/onboarding`. The page (`page.tsx`) has no completion guard either, so a returning user who already scanned lands back on the blank wizard with no "resume" or "you're set up" state.
- **Impact**: Every user who is interrupted mid-flow (stalls, OAuth re-consent for `read:org`, tab switches) — a large slice on first run. Lost progress is a top abandonment cause in multi-step onboarding.
- **Fix sketch**: Persist `{phase, org, sourceLabel, sourceInstallId, selected[]}` to `sessionStorage` on change in `OnboardingFlow`, rehydrate in a `useEffect`. Add a server check in `page.tsx` (has the viewer scanned any repo?) that renders a "Welcome back — resume / view dashboard" banner instead of the cold start. ~1 day.

## 3. Scan-complete rows are dead ends — no drill-in to the report just generated
- **Severity**: High
- **Category**: feature
- **File**: src/components/onboarding/OnboardingScanRow.tsx:11-29
- **Scenario**: Scan finishes, the user sees `acme/api · L2 · 48` and wants to know *why* that repo scored low — the exact "aha" moment onboarding should capture. They have nowhere to click.
- **Gap**: `ScanRowView` renders the score as static text with no link/onClick (grep confirmed: no `href`/`Link`/`push` in the file). Yet a full per-repo report page exists at `src/app/report/[owner]/[repo]/page.tsx`. The only post-scan CTAs are the org-level "View dashboard" and "Scan another" (`OnboardingScanStep.tsx:108-121`). The single most curiosity-driven click — "show me this repo's findings" — is unreachable from the results.
- **Impact**: Every user who completes a scan. Drilling into one concrete report is what converts a number into understood value and motivates fixing/sharing; losing it flattens the payoff of the whole flow.
- **Fix sketch**: Make each completed (non-error) `ScanRowView` a `Link` to `/report/${owner}/${repo}`; split `row.repo` on `/` for the path. Add a subtle "view report →" affordance on hover. ~0.5 day.

## 4. No "what your score means" moment — scores land with zero interpretation
- **Severity**: High
- **Category**: user_benefit
- **File**: src/components/onboarding/OnboardingScanStep.tsx:52-60
- **Scenario**: A first-time user sees "L3 · 62" and "L1 · 18" with a red/green glyph and has no idea whether that is good, what the five levels mean, or what the maturity ladder is measuring.
- **Gap**: The done state shows only level id + overall + glyph (`OnboardingScanRow.tsx`) with no legend or explainer. Grep found no "what your score means" / level-legend component in onboarding (`scan-accessibility`-style none), and the only level *descriptions* in the codebase live in the PDF report (`src/lib/pdf/report-document.tsx:71`) and report validator — never surfaced in the wizard. `LEVEL_GLYPH`/`LEVEL_CLASSES` exist in `src/lib/ui.ts` but carry no prose.
- **Impact**: Every new user; comprehension is the bridge from "I got a number" to "I understand my org's posture and what to improve." Without it the maturity framing — the product's core differentiator — is invisible at the moment it matters most.
- **Fix sketch**: Add a compact, collapsible "How maturity levels work" legend to `OnboardingScanStep`'s done state (L1→L5 with one-line descriptions, reusing the ladder copy from the report). Optionally a tooltip per `ScanRowView` glyph. Static content, no backend. ~0.5 day.

## 5. No team-invite during onboarding despite full RBAC backend
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/onboarding/OnboardingChecklist.tsx:227-241 (steps defined in OnboardingFlow)
- **Scenario**: An eng lead scans their org and wants to bring teammates into the dashboard while motivation is high — the natural viral/expansion moment right after seeing cross-repo results.
- **Gap**: The activation checklist ends at "View cross-repo analysis"; there is no "invite your team" step. A complete org-members RBAC backend already exists (`src/app/api/org/members/route.ts`, roles owner/admin/member/viewer via `setMembershipRole`) and lets an owner grant access *without* a GitHub App install — ideal for onboarding invites — but the wizard never touches it. Grep confirms no email/invite-sending infra exists, so the lightest version is link/handle-based grants, not email.
- **Impact**: Org owners (the buyers). Inviting collaborators at peak motivation drives seat expansion and multi-user activation (the strongest retention signal in fleet products).
- **Fix sketch**: Add a checklist step + small "Invite teammates" panel in the done state that POSTs GitHub handles to `/api/org/members` with `role: viewer` for the scanned org. Mark "done" by member count > 1. ~1 day (UI + wiring; no new backend).

## 6. No zero-setup sample/demo scan for users without an obvious org
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/onboarding/OnboardingPickStep.tsx:11
- **Scenario**: A solo dev or evaluator with no GitHub App install and no org membership lands on the wizard. Their only path is to type a public handle; the canned `SUGGESTIONS = ["vercel","anthropics","openai"]` are someone else's repos, not a guided "here's exactly what Ascent produces" demo.
- **Gap**: There is no curated sample/demo repo or one-click "see an example report" path. The suggestions are bare buttons that still require choosing repos and waiting for a (mock) scan. No pre-baked example exists in the flow (confirmed: no `sample`/`demo` references in onboarding). Users who don't immediately connect their own repo have no instant-gratification on-ramp.
- **Impact**: Evaluators, solo devs, and anyone hesitant to install the App or expose their org first — a meaningful share of top-of-funnel. A zero-setup example is a proven activation lever for tools requiring repo access.
- **Fix sketch**: Add a "See an example scan" CTA in `PickStep` that jumps straight to a pre-seeded sample org dashboard (or a single curated `/report/[owner]/[repo]` with annotation), bypassing pick/select. Reuse the existing seed script (`scripts/seed-org.mjs`, referenced in import route) to maintain a demo tenant. ~1 day.
