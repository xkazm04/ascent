# Executive Briefing — bug-hunter + ui-perfectionist scan

> Context: Executive Briefing (group: Org Planning & Execution)
> Files scanned: 9
> Total: 7 findings (Critical: 0, High: 1, Medium: 3, Low: 3)

_Security note (verified, NOT a finding): the share token is well-built — HMAC-SHA256 over a base64url payload (unforgeable, not `Math.random`/sequential), `timingSafeEqual` with a length pre-check, `exp` enforced on READ (`briefing-share.ts:76`), and minting gated by `requireOrgRole(org,"owner")` on the ACTIVE Supabase wall (`authGateEnabled()`), not the dormant `isAuthConfigured()` path. The PDF route gates on `requireOrgRead` (also the active wall). The share page renders LESS than the owner page (no repo-name movement rows), so no extra leak. The `postureCounts["ai-native"|"ungoverned"]` keys in the adoption math match `types.ts:476`._

## 1. Relative-range share links re-float to the recipient's clock (period silently drifts)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: clock-drift
- **File**: src/lib/briefing-share.ts:44-51
- **Scenario**: Owner shares a "Last 90 days" briefing on Jul 1; the token carries only `range:"90d"` (no `from`/`to`). A board member opens it Jul 8 — `share/.../page.tsx:56` calls `resolveWindow({range:"90d"})`, which snaps `start` to `now - 90d` at THEIR render time. They see a different 90-day window (and potentially different maturity/movement numbers, incl. scans done after sharing) than the owner presented.
- **Root cause**: The file header promises "the window travels so the recipient sees the same period," but only the range KEY travels; for the 3 relative presets (30d/90d/quarter — 90d is the default) the absolute window is recomputed downstream against the viewer's clock. Only `custom` (explicit from/to) actually freezes.
- **Impact**: A board deliverable shows numbers that no longer match what the owner reviewed/intended; drifts up to the full 7-day TTL. UX/trust degradation for the exact stakeholder the feature targets.
- **Fix sketch**: In `signBriefingShareToken`, resolve the range to absolute `from`/`to` at mint time (call `resolveWindow` server-side) and always carry concrete dates, so the recipient's page re-runs the identical fixed window.

## 2. Share button advertises "14 days" but tokens expire in 7
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/org/BriefingShareButton.tsx:43
- **Scenario**: `setMsg("Read-only link copied — valid 14 days.")` is hardcoded, but `DEFAULT_TTL_MS = 7 days` (`briefing-share.ts:10`, comment: "shortened from 14d"). The route returns the real `expiresAt` (`share/route.ts:33`) and the button ignores it.
- **Root cause**: Copy was not updated when the TTL was halved; the returned `expiresAt` is discarded rather than being the single source of truth.
- **Impact**: An owner tells a board member "valid 14 days"; the link is dead on day 8. Confusing, erodes trust in the deliverable.
- **Fix sketch**: Read `d.expiresAt` from the response and render a real relative/absolute expiry (e.g. `new Date(d.expiresAt).toLocaleDateString()`), or at minimum change the literal to 7 days.

## 3. Clipboard failure shows false "Link copied" and the stateless link is unrecoverable
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: success-theater
- **File**: src/components/org/BriefingShareButton.tsx:40-42
- **Scenario**: `navigator.clipboard?.writeText(url).catch(() => {})` — on a non-secure/permission-denied/unfocused context `navigator.clipboard` is undefined or the write rejects; both are swallowed, then `setState("copied")` + "Read-only link copied" run unconditionally. The token is stateless (never persisted server-side), so the user has NO other way to retrieve the link they were told was copied.
- **Root cause**: Success is asserted independently of whether the copy actually resolved, and there is no fallback surface for the URL.
- **Impact**: User believes they shared a link they never got; must re-mint (another public link). Silent data-availability loss.
- **Fix sketch**: `await` the write in the `try` (no swallow); on rejection set an "error/manual" state that renders the URL in a readonly, click-to-select `<input>` so the user can copy it by hand.

## 4. No warning that this mints a PUBLIC, account-less link to private board data
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: destructive-action-guard
- **File**: src/components/org/BriefingShareButton.tsx:50-63
- **Scenario**: A single click on "Share read-only link" immediately mints a bearer link that anyone (no login) can open to view the org's maturity, benchmark, goals and trajectory. The button title and the "Read-only link copied" message never convey that the link is public/unauthenticated or that anyone holding it can view.
- **Root cause**: The control treats publishing private org data to the open web as a frictionless copy action, with no confirmation and no statement of exposure.
- **Impact**: Owners under-estimate the blast radius and paste the link into semi-public channels; combined with weak revocation (#6) this is how private board data leaks.
- **Fix sketch**: Add an inline confirm or a persistent caption — "Anyone with this link can view this briefing without signing in · expires in 7 days" — and echo the real expiry from the response.

## 5. Revocation check fail-closes on a transient members read, killing a valid link mid-meeting
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: error-handling
- **File**: src/app/share/briefing/[token]/page.tsx:44-46
- **Scenario**: For a `mintedBy`-bound token, `getMembershipRole(...).catch(() => null)` then `roleAtLeast(null,"owner")` → false → "Link revoked". A transient DB blip during a board presentation makes a still-valid link show a permanent-sounding "revoked" message.
- **Root cause**: A lookup ERROR is collapsed into the same result as a confirmed not-owner; fail-closed is defensible for a security lever but the two cases warrant different UX.
- **Impact**: Intermittent false "revoked" on infra hiccups; the board member reasonably concludes access was pulled.
- **Fix sketch**: Distinguish the thrown-error case from a resolved non-owner; on error render a transient "Temporarily unavailable, try again" notice (retryable) rather than "Link revoked".

## 6. No single-link revocation; leaked links live the full TTL
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: missing-capability-revocation
- **File**: src/lib/briefing-share.ts:21-52
- **Scenario**: An owner mis-sends a link. Under the Supabase wall the only kill switch is removing/demoting the minting owner — which revokes ALL their links AND their own access. In legacy/auth-off modes `mintedBy` is unset, so tokens are entirely un-revocable for 7 days. Rotating `BRIEFING_SHARE_SECRET` invalidates every outstanding link at once.
- **Root cause**: Stateless bearer token with no per-link identifier or server-side allow/deny set — there is nothing to target for a surgical revoke.
- **Impact**: A single fat-fingered share can't be undone without collateral; accepted-risk gap for a public-data capability.
- **Fix sketch**: Add a per-token `jti` to the payload plus a small persisted revocation set (or an active-token table); check it on read so one link can be killed without touching the owner or the secret.

## 7. Share page renders the marketing header (Pricing/About/Sign-in) to an anonymous board viewer
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/app/share/briefing/[token]/page.tsx:69
- **Scenario**: The capability page uses the marketing `SiteHeader`, which includes `OrgEntryLink` + `HeaderAccount` (sign-in / "enter your org") and Leaderboard/Pricing/About nav. A board member who opened a read-only link is shown account/sales chrome irrelevant to a no-account viewer, while the org dashboard deliberately uses a stripped header.
- **Root cause**: Reuse of the full marketing chrome on a context that is neither marketing nor an authenticated dashboard.
- **Impact**: Cluttered, slightly off-brand read-only experience; sign-in prompts imply the viewer is missing access they were never meant to have.
- **Fix sketch**: Render a minimal header (logo + "Read-only shared briefing" only), dropping the account/marketing nav for the token view.
