> Total: 4 findings (0 critical, 1 high, 1 medium, 2 low)

# Org Branding & White-label — combined bug+ui scan

## 1. logoUrl is an unrestricted server-side fetch (SSRF) at PDF render
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: security / SSRF
- **File**: src/lib/db/branding.ts:34
- **Scenario**: An org owner on a Team/Enterprise plan POSTs `/api/org/branding` with `logoUrl: "https://169.254.169.254/latest/meta-data/iam/security-credentials/"` (or any internal host, e.g. `https://10.0.0.5:8080/admin`). It passes the only validation — `/^https:\/\/[^\s]+$/i` — and is stored. On the next `GET /api/org/briefing/pdf`, the nodejs-runtime route renders `BriefingDocument`, whose `<Image src={branding.logoUrl}>` (briefing-document.tsx:92) makes `@react-pdf/renderer` fetch that URL server-side from inside the app's network.
- **Root cause**: The validation only checks the URL *scheme/shape*, not its *destination*. The comment ("https logo, else stored null so a bad input can't break PDF rendering") treats the URL as a rendering-safety concern, not an egress concern — there is no host allowlist, no private/link-local/loopback IP block, and no DNS-rebinding protection. The PDF route deliberately fetches it server-side and even has a "bad/unreachable logo" fallback, normalizing failures so probing is quiet.
- **Impact**: Authenticated SSRF — owner can make the server fetch cloud metadata endpoints, internal-only services, or port-scan the VPC; timing/error differences from the branded-vs-unbranded fallback leak reachability. Blast radius is bounded to org owners on a paid tier, which is why this is High not Critical, but it is a real, exploitable egress.
- **Fix sketch**: Resolve the host and reject private/loopback/link-local/metadata ranges (and re-check after DNS resolution to defeat rebinding); restrict to an allowlist of image CDNs or proxy logos through a fetch that pins the resolved public IP; optionally fetch-and-store the image bytes once at save time rather than fetching attacker-controlled URLs at every render.

## 2. White-label persists after plan downgrade (entitlement bypass on the read path)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: authorization / billing
- **File**: src/app/api/org/briefing/pdf/route.ts:43
- **Scenario**: An org on Team sets brand name/color/logo (write path correctly gates on `planAllowsWhiteLabel`). The org later downgrades to free. The stored `brandName/brandColor/logoUrl` columns are never cleared. Every subsequent `GET /api/org/briefing/pdf` calls `getOrgBranding(org)` with **no** entitlement check and applies the branding — the PDF still drops "Ascent" from the title, footer ("Scored by {brandLabel}"), and download filename.
- **Root cause**: Entitlement is enforced only at write (`route.ts` POST) but the apply/read path (`getOrgBranding` + `briefing/pdf`) assumes "branding present ⇒ entitled". There is no re-validation of the current plan when rendering, and downgrade does not purge branding rows.
- **Impact**: A paid feature (white-labeled exec PDFs) keeps working indefinitely after a customer drops to a non-entitled tier — revenue leak and inconsistent enforcement. Same gap applies if an org was ever Team and is now free.
- **Fix sketch**: In `briefing/pdf` (and any other consumer), gate the branding the same way the executive page already does — `planAllowsWhiteLabel(credit?.plan) ? branding : undefined` — or clear branding columns on downgrade in the billing webhook.

## 3. Custom accent color can render invisible (no contrast floor) on the white PDF
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: contrast / branding application
- **File**: src/lib/pdf/briefing-document.tsx:93
- **Scenario**: Owner picks/sets an accent of `#ffffff` (or any near-white like `#fefefe`). It passes the `^#[0-9a-fA-F]{6}$` check, is stored, and becomes the color of the kicker line ("{brand} · Executive briefing") and the section heading accent — white text on the white (`INK`/light) PDF page, effectively invisible. The browser `type="color"` picker doesn't prevent white selection.
- **Root cause**: `brandColor` is applied verbatim as foreground text color with no luminance/contrast check against the fixed light PDF background; validation only constrains *format*, not *legibility*.
- **Impact**: A branded PDF can ship with an unreadable header/accent; the org sees a broken-looking deliverable with no warning.
- **Fix sketch**: Compute relative luminance of `brandColor`; if it fails a minimum contrast ratio against the page background, fall back to `ACCENT` (or darken it) and/or warn in `BrandingSettings`.

## 4. Save status message is not announced to assistive tech
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: src/components/org/BrandingSettings.tsx:63
- **Scenario**: A keyboard/screen-reader user activates "Save". The success/error feedback (`Saved — the next briefing PDF…` / error text) is injected into a plain `<p>` with no live-region role. Nothing is announced; the user gets no confirmation the action succeeded or failed.
- **Root cause**: The status `<p>` lacks `role="status"`/`aria-live="polite"` (errors warrant `aria-live="assertive"`), and the Save button has no `aria-busy` during the saving state.
- **Impact**: Non-visual users can't tell whether branding saved, leading to repeated submits or silent failure perception. Minor but a clear WCAG status-message gap.
- **Fix sketch**: Add `role="status" aria-live="polite"` (assertive for the error variant) to the message paragraph and `aria-busy={state === "saving"}` to the Save button.
