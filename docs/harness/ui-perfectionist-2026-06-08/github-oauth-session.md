# UI Perfectionist — GitHub OAuth & Session

> Total: 3 findings (0 critical, 1 high, 1 medium, 1 low)
> Context: GitHub OAuth & Session | Files audited: 4

## 1. Expired-session alert breaks the centered column on wide viewports
- **Severity**: High
- **Category**: responsive
- **File**: src/components/SignInNotice.tsx:17
- **Scenario**: On the expired branch the amber banner renders between the title and the body. The body below it is capped at `max-w-md`, but the alert paragraph has no width cap. Its copy is a long single sentence ("You were signed out after a period of inactivity. Sign in again to pick up where you left off."), so on a wide page the amber pill stretches noticeably wider than the body and CTA beneath it.
- **Root cause**: The host `EmptyState` page variant is `flex flex-col items-center` with no container max-width (EmptyState.tsx:46), and it constrains only the body (`max-w-md`, EmptyState.tsx:49) — not the injected `alert` slot. The alert is a hand-passed node, so it carries its own (absent) width constraint. A block-level `<p>` flex item with long text grows toward the available cross-size, leaving the banner unaligned with the rest of the centered stack.
- **Impact**: The three stacked elements (alert / body / button) no longer share one visual column, so the notice looks misaligned and unpolished precisely on the wider screens most desktop users have — and it's the alarming "you were signed out" surface where calm, tidy framing matters most.
- **Fix sketch**: Add `max-w-md` (matching the body) to the alert `<p>` so it shares the body's measure: `className="mt-3 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm text-amber-300"`. Centering already comes from the flex parent.

## 2. Body copy is onboarding-framed even when a returning user was just signed out
- **Severity**: Medium
- **Category**: states
- **File**: src/components/SignInNotice.tsx:25
- **Scenario**: The body string "Connect your GitHub account to access private repositories, history, and usage." is passed unconditionally. In the `expired` state the user sees: title "Your session expired", an amber alert about inactivity, and then this body telling them to "Connect your GitHub account" — first-time-setup language aimed at someone who has not yet linked GitHub.
- **Root cause**: The component branches `expired` for `title` and `alert` but reuses one body for both states (SignInNotice.tsx:14 vs 25). A returning user whose session timed out already has a connected account; "Connect your GitHub account…" mismatches their reality and partly duplicates the alert's "sign in again" message.
- **Impact**: Mixed mental models on a sensitive auth surface — the returning user briefly wonders whether they've lost their connection/data, undercutting the reassurance the expired banner is trying to convey. It also reads as two slightly contradictory instructions stacked together.
- **Fix sketch**: Make the body state-aware, e.g. `body={expired ? "Re-authenticate with GitHub to restore access to your repositories, history, and usage." : "Connect your GitHub account to access private repositories, history, and usage."}`. Keeps one component, one EmptyState, but each state reads coherently.

## 3. Lock icon is identical for first-time and expired states
- **Severity**: Low
- **Category**: polish
- **File**: src/components/SignInNotice.tsx:13
- **Scenario**: Both branches pass `icon="🔐"`. The component already differentiates the two states via title and an alert banner, but the lead glyph — the first thing the eye lands on — is the same in both.
- **Root cause**: `icon` is hardcoded while `title`/`alert` are conditional, so the strongest visual anchor doesn't participate in the state distinction the rest of the component makes.
- **Impact**: Minor missed signal: a returning user mid-session-timeout gets no at-a-glance cue that this is a re-auth (not a brand-new sign-up), so they must read to disambiguate. Purely a polish nit — the icon is decorative (`aria-hidden` in EmptyState.tsx:54), so there's no accessibility regression either way.
- **Fix sketch**: Optionally swap the expired glyph to something that reads as "timed out / refresh", e.g. `icon={expired ? "⏳" : "🔐"}`. Low priority; skip if the team prefers a single stable auth glyph for brand consistency.
