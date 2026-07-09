# Org Branding & White-label — bug-hunter + ui-perfectionist scan

> Context: Org Branding & White-label (group: Org Dashboard & Analytics)
> Files scanned: 3
> Total: 6 findings (Critical: 0, High: 0, Medium: 2, Low: 4)

Note: the security surface the brief flagged is already closed. The write route is owner-gated via the ACTIVE `authGateEnabled()` path (authz.ts:193), derives the role from the session viewer (org slug is body-supplied but validated against real membership → no IDOR), rejects cross-origin, and re-checks entitlement on both write and render. `brandColor` is strictly `#rrggbb` (color.ts:8) → no CSS injection. Logo SSRF/DNS-rebinding is handled by `resolveSafeLogoDataUri` (logo-fetch.ts) which resolves-and-checks before fetch. Findings below are the residual UI/correctness gaps.

## 1. No colour-contrast validation — an owner can pick an accent invisible on the white PDF
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: color-contrast
- **File**: src/components/org/BrandingSettings.tsx:67
- **Scenario**: A reseller opens Briefing branding and picks a pale accent (e.g. `#ffffff`, `#f5f5f5`). It saves fine, then `brandColor` is used as the kicker TEXT colour on the light PDF page (briefing-document.tsx:94, `color: accent`). The branded "· Executive briefing" line renders unreadable/invisible against the white background.
- **Root cause**: The form assumes any well-formed hex is a usable brand colour; it never checks the accent's contrast against the surface it lands on (white PDF page). Validity ≠ legibility.
- **Impact**: A paid white-label deliverable a reseller hands to a client ships with an invisible/washed-out brand header — silent quality degradation the owner can't see in the form.
- **Fix sketch**: Compute WCAG contrast of `brandColor` vs the PDF page background (`#ffffff`) client-side; if below ~3:1 show an inline warning ("this accent will be hard to read on the report") next to the picker before save.

## 2. Native color input can never clear the accent and pre-fills the Ascent default as the owner's choice
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: form-state
- **File**: src/components/org/BrandingSettings.tsx:12
- **Scenario**: An org that never set an accent sees the picker pre-filled with `initial.brandColor ?? "#2563eb"`. A native `<input type="color">` can only emit a valid hex, never empty, so the first Save POSTs `#2563eb` — writing an explicit override equal to today's default. There is also no affordance to clear a previously-set accent back to null (the server treats empty→null, but the picker can't produce empty).
- **Root cause**: A default display value is conflated with a user selection, and the control has no null state, yet the model supports "unset → inherit Ascent default."
- **Impact**: Orgs get silently pinned to `#2563eb`, so a future change to Ascent's default accent won't reach them; and an owner can never revert to the default once set. UX + subtle data-correctness.
- **Fix sketch**: Track whether the user touched the picker; only send `brandColor` when touched or already set. Add a "Use default accent" clear button that sends `brandColor: ""` (null) and greys the swatch when unset.

## 3. No unsaved-changes / dirty tracking on the form
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: form-state
- **File**: src/components/org/BrandingSettings.tsx:17
- **Scenario**: The Save button is enabled whenever `state !== "saving"`, independent of whether any field differs from `initial`. Clicking Save with no edits fires a redundant write; after a successful save `initial` is never updated, so the component's notion of "original" is permanently stale.
- **Root cause**: No `dirty` derivation comparing current fields to `initial`; the form has no concept of a clean vs modified state.
- **Impact**: Redundant writes, no visual "you have unsaved changes" cue, and a stale baseline after the first save. Minor but affects a settings form owners revisit.
- **Fix sketch**: Derive `dirty = brandName/brandColor/logoUrl !== initial.*`; disable Save when `!dirty`; on success set a local baseline to the stored values so `dirty` resets.

## 4. Logo URL has no live preview — a broken/wrong image only surfaces in the shipped PDF
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: live-preview
- **File**: src/components/org/BrandingSettings.tsx:69
- **Scenario**: An owner pastes a logo URL and clicks Save. The only feedback is a post-save warning IF the server rejected the URL as non-https/private. A valid-but-wrong URL (404 at render, a non-image, a huge asset) saves "successfully"; the owner never sees the logo until it lands (or silently doesn't) in a board PDF.
- **Root cause**: Validation is server-side only and format-level; the form gives no visual confirmation the URL actually resolves to the intended image.
- **Impact**: A branded deliverable can go out with a missing or wrong logo with no in-form signal. UX degradation for the exact paying users this feature targets.
- **Fix sketch**: Render a small `<img>` preview of the entered URL with `onError` → "couldn't load this image" so the owner catches a bad logo before saving.

## 5. Stale SSRF comment claims @react-pdf still fetches the logo URL server-side
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: documentation-drift
- **File**: src/lib/db/branding.ts:27
- **Scenario**: The block at lines 27–33 states DNS-rebinding "needs a resolve-and-pin at the fetch site, which @react-pdf owns; tracked as a follow-up," implying the logo URL is still fetched by @react-pdf as an open egress vector. In reality briefing/pdf/route.ts:57-62 now pre-resolves the logo to a `data:` URI via `resolveSafeLogoDataUri` (which resolves the host and rejects private addresses), so @react-pdf never makes the request — the "follow-up" is done.
- **Root cause**: The comment wasn't updated when the mitigation moved to the fetch site; it describes a prior architecture.
- **Impact**: A maintainer reading this file believes a live SSRF egress remains open (or duplicates the now-existing mitigation). No runtime effect, but misleads security triage.
- **Fix sketch**: Update the comment to point at `resolveSafeLogoDataUri`/`logo-fetch.ts` as the resolve-and-pin site, and note the write-time check is defense-in-depth only.

## 6. Logo URL is validated then truncated to 500 chars without re-validation
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/branding.ts:64
- **Scenario**: `isSafeLogoUrl` runs on the full URL, then the value stored is `input.logoUrl.trim().slice(0, 500)`. A legitimate >500-char URL (signed CDN link with query params) is stored truncated/broken. The route echoes it back non-null, so the client shows plain "Saved" (no rejection warning), but at render `resolveSafeLogoDataUri` re-parses the truncated string and it fails → the logo is silently dropped from the PDF.
- **Root cause**: Truncation happens after validation and the truncated result is never re-checked or reported as altered; "stored non-null" is treated as "stored intact."
- **Impact**: Owner sees success, PDF ships with no logo. Narrow (very long URLs) and no security regression (host is at the front, so truncation can't make it private), but a genuine success-that-lied.
- **Fix sketch**: If the trimmed URL exceeds 500 chars, reject it (push to `rejected`) rather than truncate, so the form warns "logo URL too long" instead of storing a broken value.
