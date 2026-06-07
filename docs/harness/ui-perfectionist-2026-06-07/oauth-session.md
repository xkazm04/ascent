# UI Perfectionist — GitHub OAuth & Session

> Total: 3
> Severity: critical 0 · high 1 · medium 1 · low 1
> Scope: 1 file (GitHub OAuth & Session)

## 1. SignInNotice hand-rolls the canonical EmptyState/notice scaffold instead of reusing `EmptyState`
- **Severity**: high
- **Category**: component-architecture
- **File**: `src/components/SignInNotice.tsx:8`
- **Scenario**: Shown full-page on every auth-gated route when no session is present (first-time prompt or, with `expired`, a timed-out session).
- **Root cause**: The component re-implements the exact centered-notice scaffold that `EmptyState.tsx` was created to single-source. Compare line by line: wrapper `flex flex-col items-center py-24 text-center` (`SignInNotice.tsx:8` ≡ `EmptyState.tsx:29`), title `mt-4 text-2xl font-bold text-white` (`SignInNotice.tsx:12` ≡ `EmptyState.tsx:31`), body `mt-2 max-w-md text-slate-400` (`SignInNotice.tsx:20` ≡ `EmptyState.tsx:32`), and the actions row at `mt-6` (`SignInNotice.tsx:23` ≈ `EmptyState.tsx:34`). `EmptyState`'s own docstring (`EmptyState.tsx:11-16`) states it exists to "unify the hand-rolled variants … so the empty states stay visually consistent and a future tweak lands in one place." SignInNotice is precisely a fourth un-unified variant.
- **Impact**: This sign-in notice silently drifts from every other notice state in the app (see finding #3 — the icon already has). Any future restyle of the canonical state (icon size, spacing, dark-canvas color tweak) will land everywhere except here, leaving the auth gate visually out of sync. Maintenance cost is duplicated across two files.
- **Fix sketch**: Render the base via `EmptyState` — pass `icon="🔐"`, the conditional `title`, and the GitHub-connect `body`. The two genuine extras are (a) the GitHub CTA, which `EmptyState`'s `actions[]` only supports as a `<Link href>` (`EmptyState.tsx:36`) not the interactive `GitHubSignInButton`, and (b) the expired alert (finding #2). Smallest clean refactor: extend `EmptyState` with an optional `children`/`footer` slot rendered in the actions area so SignInNotice can drop in `<GitHubSignInButton>` and the alert while reusing the scaffold — keeping one source of truth for the wrapper/title/body.

## 2. Expired-session alert is a one-off banner with no equivalent in the shared notice pattern
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/components/SignInNotice.tsx:15`
- **Scenario**: The amber "you were signed out after inactivity" banner (`SignInNotice.tsx:16-18`) renders between the title and body only when `expired` is true.
- **Root cause**: The banner is styled with raw Tailwind color literals — `border-amber-500/30 bg-amber-500/5 text-amber-300` — while the design system already ships a dedicated warning token for exactly this surface: `--color-warn` plus the note in `globals.css:18-19` that warning accents "(was raw #f97316 in inline styles)" are meant to flow through the `warn` token, and the danger family (`globals.css:15-16`) demonstrates the intended `bg-danger/5 border-danger/30 text-danger` banner convention. Using amber-500 sidesteps both the token and the established banner recipe.
- **Impact**: An alert color that isn't part of the palette — `amber` vs the brand `warn` (#f97316 / orange) — so the expired state reads in a hue the rest of the app never uses, fragmenting the error/warning visual language. A palette retune via the token won't reach this banner.
- **Fix sketch**: Re-skin the banner with the warn token to match the documented danger-banner pattern, e.g. `border border-warn/30 bg-warn/5 text-warn-soft` (adding a `--color-warn-soft` foreground token if the solid `warn` is too dark on the dark canvas, mirroring `danger`/`danger-soft` in `globals.css:15-16`). Keep `role="alert"`.

## 3. Notice icon is `text-4xl`, off the canonical `text-5xl` used by every other notice
- **Severity**: low
- **Category**: design-system
- **File**: `src/components/SignInNotice.tsx:9`
- **Scenario**: The 🔐 glyph at the top of the sign-in notice, sized `text-4xl`.
- **Root cause**: `EmptyState.tsx:30` fixes the canonical notice icon at `text-5xl`; SignInNotice independently chose `text-4xl`. Drift on icon size is one of the exact inconsistencies `EmptyState`'s docstring (`EmptyState.tsx:11-13`) calls out as the reason the shared component exists.
- **Impact**: The sign-in icon renders visibly smaller than the icon on report/trends/usage notices, breaking the cross-page visual rhythm of the notice family — subtle but exactly the "every pixel" inconsistency the shared component was meant to eliminate.
- **Fix sketch**: Falls out for free once finding #1 is applied (the icon comes from `EmptyState`). If kept standalone short-term, change `text-4xl` → `text-5xl` to match `EmptyState.tsx:30`.
