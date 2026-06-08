# UI Perfectionist — GitHub App, Connect & Onboarding

> Total: 9 findings (0 critical, 3 high, 4 medium, 2 low)
> Context: GitHub App, Connect & Onboarding | Files audited: 6

## 1. Error/danger colors bypass the `danger` design token across the onboarding flow
- **Severity**: High
- **Category**: design-system
- **File**: src/components/onboarding/OnboardingFlow.tsx:478, 724, 746, 470
- **Scenario**: Onboarding error banners and the per-repo scan-error text render with raw `text-red-400` (`<p role="alert" className="mt-3 text-sm text-red-400">` at lines 478 and 724; `ScanRowView` error at line 746). Meanwhile the sibling connect surfaces render the *same* semantic error with the `danger` token: `connect/page.tsx:51` uses `border-danger/30 bg-danger/5 text-danger-soft`, and `InstallationRepos.tsx:193` / `:327` use `text-danger-soft` / `text-danger`.
- **Root cause**: `globals.css:16-17` defines `--color-danger` / `--color-danger-soft` precisely "for error banners (was raw red-500/300 literals)", but the onboarding component was never migrated to it. Two error visual languages now coexist in one first-run funnel.
- **Impact**: The same error severity looks different depending on which half of the flow the user is in (`#ef4444` raw red vs the slightly softer token + danger-tinted background). If the brand later retunes danger, onboarding silently desyncs — exactly the failure the token was created to prevent.
- **Fix sketch**: Replace `text-red-400` → `text-danger-soft` (or `text-danger` for inline row errors to match `InstallationRepos.tsx:327`). For the top-level onboarding error at line 478, consider promoting it to the full banner treatment (`rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger-soft`) used on the connect page so a failed import reads as a recoverable banner, not a thin red sentence.

## 2. Cancel button hover uses raw red literals instead of the `danger`/`warn` tokens
- **Severity**: Medium
- **Category**: design-system
- **File**: src/components/onboarding/OnboardingFlow.tsx:470
- **Scenario**: The scan **Cancel** button is `border-slate-700 ... hover:border-red-500/50 hover:text-red-300`. Every other destructive/error affordance in this context routes through the `danger` token; this one hardcodes `red-500` and `red-300`.
- **Root cause**: Same token-drift as Finding 1, isolated to a hover state so it's easy to miss. `globals.css` ships `--color-danger` (and `--color-warn` for amber) for exactly this.
- **Impact**: A barely-perceptible hue mismatch on hover, plus another spot that won't follow a future danger retune. Low visibility but it's a real inconsistency on a primary action.
- **Fix sketch**: `hover:border-danger/50 hover:text-danger-soft`. Cancel is arguably a *warn* (pause), not *danger* (destroy) — if you want to signal "this stops, doesn't delete," `--color-warn` is the better token. Either way, drop the raw literals.

## 3. Score chips signal maturity by hue alone — no `LEVEL_GLYPH`, failing the project's own a11y rule
- **Severity**: High
- **Category**: accessibility
- **File**: src/components/onboarding/OnboardingFlow.tsx:742; src/components/connect/InstallationRepos.tsx:282
- **Scenario**: The result chip renders `{row.level} · {row.overall}` tinted by `LEVEL_CLASSES[level]` (e.g. `text-red-400` for L1, `text-emerald-400` for L5). The connect repo-row chip does the same: `{st.level} · {st.overall}` in `lc.text`. Neither renders the `LEVEL_GLYPH` (○ ◔ ◑ ◕ ●) redundant encoding.
- **Root cause**: `lib/ui.ts:39-52` explicitly states the red→green ramp "collapses for the ~8% of men with red-green color vision deficiency, so anywhere hue signals a level/score, render this glyph (and/or the L1–L5 id) alongside it." The level id *is* present here, which partially satisfies the rule — but the glyph (the documented standard reinforcement) is omitted, and these are the highest-stakes "did my repo pass?" chips in the whole funnel.
- **Impact**: For colorblind users the L1-vs-L3-vs-L5 distinction leans heavily on reading and mapping the `L#` token; the at-a-glance pass/fail color cue is lost. The codebase already shipped the fix primitive (`scoreGlyph`/`LEVEL_GLYPH`) and just didn't apply it on these two chips.
- **Fix sketch**: Prepend the glyph: `<span aria-hidden>{LEVEL_GLYPH[level]}</span> {level} · {overall}`. Import `LEVEL_GLYPH` (already exported from `@/lib/ui`). This is a one-line change per chip that brings both surfaces in line with the documented non-color-redundancy standard.

## 4. Sticky select-bar collides with the site header (no scroll offset)
- **Severity**: High
- **Category**: responsive
- **File**: src/components/onboarding/OnboardingFlow.tsx:341
- **Scenario**: The select-phase action bar is `sticky top-0 z-10`. The page is wrapped in `SiteHeader` (`onboarding/page.tsx:27`). If `SiteHeader` is sticky/fixed (standard for a SaaS top nav), the action bar pins flush to `top: 0` and slides *under* or *over* the header, so on a long repo list the CapPill + "Select top 10"/"Clear" controls overlap the global nav.
- **Root cause**: `top-0` assumes the bar sticks to the viewport edge, but the layout reserves the top strip for `SiteHeader`. There's no `top-[header-height]` offset and no scroll-margin coordination.
- **Impact**: On the exact moment the sticky bar earns its keep (scrolling a 50-repo org list), the primary bulk-select controls can be occluded by the header — a visible layout break on a core onboarding step. Worse on short mobile viewports where the header eats more of the fold.
- **Fix sketch**: Offset the sticky bar below the header, e.g. `sticky top-16` (matching the header height) or expose the header height as a CSS var (`top-[var(--header-h)]`). Verify against `SiteHeader`'s positioning; if the header is *not* sticky, `top-0` still pins to viewport top and scrolls behind nothing — but confirm, don't assume.

## 5. "Add or manage repositories" is a bare text link with no button affordance
- **Severity**: Medium
- **Category**: visual-consistency
- **File**: src/app/connect/page.tsx:222
- **Scenario**: When installs exist, the only path to add/remove repos on GitHub is a plain mono text link: `+ Add or manage repositories on GitHub →` styled as `font-mono text-xs uppercase ... text-accent`. Directly below, every repo block's "Org dashboard →" link (`InstallationRepos.tsx:219`) and the install CTA (`connect/page.tsx:209`) are pill/filled buttons. The single most important recurring action (broaden repo access) is the least visually prominent control on the page.
- **Root cause**: It was styled as an inline accent caption rather than a button. Visual weight is inverted relative to its task importance.
- **Impact**: Users who installed with too-narrow repo access (a very common GitHub App misstep) get an empty/short repo list and the recovery action — re-scoping on GitHub — is a faint line of small-caps text that reads like a label, not a button. Hurts the primary error-recovery path of this screen.
- **Fix sketch**: Give it the same outline-button treatment as "Org dashboard →" (`rounded-lg border border-accent/40 px-3 py-1.5 ... hover:bg-accent/10`), or surface it as a secondary button beside the per-install heading. Keep the `+` glyph; raise the affordance.

## 6. The "Scan complete" done state has no success affordance — it reuses the plain "scanning" header
- **Severity**: Medium
- **Category**: states
- **File**: src/components/onboarding/OnboardingFlow.tsx:441-446, 483-487
- **Scenario**: On completion the only change is the `<h1>` text swapping to "Scan complete" and a subhead "Here's how your repositories scored." The progress bar sits full and the same row list remains. There's no success icon, no celebratory moment, no visual "you finished" punctuation — the terminal state of the entire onboarding funnel looks like the in-progress state minus motion.
- **Root cause**: The done branch (line 489) only appends the checklist + CTA buttons; it doesn't restyle the header or add a completion marker. The app *has* a celebratory primitive pattern (`EmptyState` page-variant hero with an `icon`, and the live-page `animate-burst`), none reused here.
- **Impact**: The highest-value activation moment (first scores landed) feels flat and easy to miss — first-run UX research consistently shows a visible "win" here drives retention. The bar reaching 100% green is the only signal, and that's the same green a partially-failed run shows.
- **Fix sketch**: Add a success glyph + accent halo to the done header (e.g. a check badge styled like the checklist's `border-emerald-500/50 bg-emerald-500/15` token), and consider a one-shot `animate-burst`/`animate-fade-up` on the score list. Differentiate "all passed" vs "some errored" in the subhead copy (count errors from `rows`).

## 7. Onboarding error banner doesn't auto-focus/scroll, and the input has no aria-invalid wiring
- **Severity**: Medium
- **Category**: accessibility
- **File**: src/components/onboarding/OnboardingFlow.tsx:723-727, 694-701
- **Scenario**: When `loadRepos` fails it sets `error` and returns to the pick phase; `PickForm` renders `<p role="alert">` below the submit button (line 723). The org `<input>` (line 694) is not associated with that error via `aria-invalid` / `aria-describedby`, and nothing moves focus back to the field. The error also lacks the `animate-shake` "rejected submit" feedback that `globals.css:96-111` was built for.
- **Root cause**: The error is a sibling `<p>` with `role="alert"` but no programmatic link to the control that produced it, and no focus management on the round-trip back to the pick phase.
- **Impact**: A screen-reader user hears the alert text but the input isn't announced as invalid; a keyboard user is left wherever focus landed after the phase remount. The validation feedback is there visually but not wired for assistive tech — partial a11y on the flow's main input.
- **Fix sketch**: Add `aria-invalid={!!error}` and `aria-describedby="onboarding-org-error"` to the input, give the `<p>` that id, move focus to the input on error, and apply `animate-shake` to the field on rejected submit (the keyframe + reduced-motion guard already exist).

## 8. Hardcoded `#04070e` instead of the `text-on-accent` token on emerald CTAs
- **Severity**: Low
- **Category**: design-system
- **File**: src/components/onboarding/OnboardingFlow.tsx:620; src/app/connect/page.tsx:152
- **Scenario**: The `SeededOrgBanner` "View dashboard" button uses `text-[#04070e]` (line 620), as does the connect page's seeded-org CTA (`connect/page.tsx:152`). Yet the *accent* buttons in the very same files correctly use the `text-on-accent` token (e.g. `connect/page.tsx:209`, `OnboardingFlow.tsx:411/705`).
- **Root cause**: `globals.css:11-13` defines `--color-on-accent: #04070e` specifically because this value "was previously hardcoded as #04070e across connect/onboarding/auth." These emerald buttons predate or were missed by that migration.
- **Impact**: Cosmetically identical today, but it's exactly the literal the token was introduced to eliminate. Token-on-accent semantics also technically describe the *azure* accent foreground; on emerald the same near-black happens to read fine, so reusing `text-on-accent` here is both correct and DRY.
- **Fix sketch**: Replace both `text-[#04070e]` with `text-on-accent`. (The remaining raw `#04070e` in `lib/ui.ts:113` is a computed contrast pick in a pure function and is correctly out of token scope.)

## 9. Uppercase eyebrow letter-spacing is inconsistent (`tracking-[0.3em]` vs `tracking-widest`)
- **Severity**: Low
- **Category**: visual-consistency
- **File**: src/app/connect/page.tsx:41 vs :141; src/components/onboarding/OnboardingFlow.tsx:579, 610, 644, 689
- **Scenario**: The page-title eyebrows use `tracking-[0.3em]` ("Connect GitHub" at connect/page.tsx:41; "Get started" at onboarding/page.tsx:31), but every *section* eyebrow uses `tracking-widest` (= `0.1em`) — "Discovered from your GitHub" (connect/page.tsx:141), and all four card eyebrows in OnboardingFlow (lines 579, 610, 644, 689). Both are the same visual element (mono, 11px, uppercase, accent/slate).
- **Root cause**: Two letter-spacing values for one repeated typographic role, chosen ad hoc per component. There's no shared eyebrow class, so the spacing diverges by location.
- **Impact**: Subtle but real typographic incoherence — the same "kicker" label breathes differently between the page header and the cards beneath it, which a careful eye reads as unpolished. Pure consistency nit.
- **Fix sketch**: Pick one tracking for the eyebrow role (the wider `0.3em` reads more deliberate at this size) and extract a small `eyebrow` className/component (e.g. `font-mono text-[11px] uppercase tracking-[0.3em]`) reused across connect + onboarding so the role can never drift again.
