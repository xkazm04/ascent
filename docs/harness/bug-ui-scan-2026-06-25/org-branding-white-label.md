# Org Branding & White-label — Bug + UI Scan
> Context: Org Branding & White-label (Org Dashboard & Analytics)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. "Saved with your brand" lies when the logo/name is silently dropped
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/db/branding.ts:45-48 · src/app/api/org/branding/route.ts:30-36 · src/components/org/BrandingSettings.tsx:24-29
- **Value**: impact 6 · effort 3 · risk 2
- **Scenario**: An owner pastes `http://acme.com/logo.png` (not https), a private/typo host, or a 120-char brand name and clicks Save. `setOrgBranding` normalizes a non-passing logo to `null` and `.slice(0,80)` truncates the name, then `route.ts` returns `{ ok: true }` regardless of what was discarded. The UI shows the green "Saved — the next briefing PDF uses your brand." The owner believes the logo is set; the next briefing PDF renders with no logo and a truncated name, with no signal anything went wrong.
- **Root cause**: "Store-null-instead-of-reject so the PDF always renders" is the right rendering policy, but the API never reports *what it actually stored*, and the client hard-codes a success message instead of reflecting server state. Success theater across the whole write path.
- **Impact**: User confusion on the feature's headline capability (the logo); silent data loss of the intended value; support churn ("my logo isn't showing").
- **Fix sketch**: Have `setOrgBranding` return the normalized `{brandName, brandColor, logoUrl}` (or a `dropped: string[]`), have `route.ts` echo it, and in `BrandingSettings.save()` compare submitted vs. stored — warn ("Logo URL ignored: must be a public https image"; "Name shortened to 80 chars") instead of unconditional success. Add `maxLength={80}` / a client https check for fast feedback.

## 2. White-label keeps applying after a plan downgrade (entitlement leak)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/app/api/org/briefing/pdf/route.ts:46-61 · src/lib/db/branding.ts:17-25 · src/app/api/org/branding/route.ts:25-28
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: An org on Team sets brand name/color/logo (write path correctly gates on `planAllowsWhiteLabel`). The org later downgrades to free/pro. The `brandName/brandColor/logoUrl` columns are never cleared, and `GET /api/org/briefing/pdf` calls `getOrgBranding(org)` with **no** entitlement re-check, then applies the brand to the PDF title, kicker, logo, footer author, and even the download filename (`brandSlug`).
- **Root cause**: Entitlement is enforced only at *write*; the *apply/read* path assumes "branding row present ⇒ still entitled." No plan re-validation at render and no purge of branding on downgrade. (Same gap was noted in the 2026-06-20 scan; still open.)
- **Impact**: A paid feature is delivered indefinitely after the customer stops paying for it — a revenue/entitlement leak, and inconsistent with the executive page which *does* gate on `planAllowsWhiteLabel`.
- **Fix sketch**: In `briefing/pdf` resolve `getCreditState(org)` alongside branding and pass `planAllowsWhiteLabel(plan) ? branding : undefined` (mirror `executive/page.tsx:54`). Optionally also clear the three columns in the billing webhook on downgrade.

## 3. A transient credit-state read error masquerades as "not entitled"
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/app/api/org/branding/route.ts:25-28
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: `getCreditState(body.org).catch(() => null)` swallows any DB hiccup to `null`; `planAllowsWhiteLabel(null)` is `false`, so a legitimate Team/Enterprise owner gets `403 "Briefing branding is a Team-plan feature."` during a transient outage — a misleading "you don't have this plan" denial rather than a "try again" error.
- **Root cause**: Collapsing two distinct outcomes (genuinely-not-entitled vs. couldn't-determine-entitlement) into one `null`, then mapping `null` to "denied."
- **Impact**: A paying owner is told they lack the plan and can't update branding until the blip clears; erodes trust in billing accuracy.
- **Fix sketch**: Distinguish the failure: let the `catch` return a sentinel/throw a 503 ("Couldn't verify your plan, try again") instead of folding into the entitlement-denied path.

## 4. Save/error status is invisible to screen-reader users
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/org/BrandingSettings.tsx:60-64
- **Value**: impact 4 · effort 2 · risk 1
- **Scenario**: The Save button has no busy/disabled announcement beyond a text swap, and the result message `<p>{msg}</p>` (lines 64) is a plain paragraph injected after the request resolves — it is not a live region, so assistive tech announces neither "Saving…", "Saved", nor the error. The sibling `LlmProviderSettings` was built on this component as a template but added `role="status"`/`aria-busy`; this original lacks them.
- **Root cause**: Status conveyed purely visually (green/orange text) with no ARIA live region or `aria-busy`.
- **Impact**: SR/keyboard users get no confirmation a save succeeded or failed — they may resubmit or assume it silently failed.
- **Fix sketch**: Add `role="status" aria-live="polite"` to the message `<p>` (and `role="alert"` when `state === "error"`), and `aria-busy={state === "saving"}` on the button/form. Pure additive markup.

## 5. Server-side logo fetch is still reachable via DNS rebinding
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/db/branding.ts:27-36 · src/lib/net/ssrf.ts:47-57 · src/app/api/org/briefing/pdf/route.ts:46-54
- **Value**: impact 5 · effort 6 · risk 4
- **Scenario**: `isSafeLogoUrl` validates only the *literal* hostname (https + not a private/internal IP literal). `@react-pdf` then fetches `<Image src={logoUrl}>` **server-side, from inside the app network**, at every PDF render. An owner can supply `https://attacker.example/logo` whose DNS resolves public at validation time but rebinds to `169.254.169.254`/`127.0.0.1`/an internal host at fetch time, turning the render into an SSRF egress probe. The code comment itself flags this as an unmitigated follow-up.
- **Root cause**: Validation happens at write time on the hostname string; there is no resolve-and-pin at the fetch site, and the fetch is owned by `@react-pdf`, so the gap is real and persistent rather than theoretical.
- **Impact**: Potential reach to cloud metadata / internal services from the server; constrained (requires a Team+ owner controlling DNS) but a genuine egress vector, not just a render-safety concern.
- **Fix sketch**: Fetch the logo through an app-controlled proxy that resolves the host, rejects private/link-local/CGNAT/metadata IPs, pins the resolved IP for the actual GET, caps size/content-type to images, and passes the validated bytes (data URI / local path) to `@react-pdf` instead of a remote URL.
