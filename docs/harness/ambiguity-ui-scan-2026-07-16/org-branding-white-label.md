# Org Branding & White-label — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. White-label scope drift: branding only reaches the PDF, not the on-screen briefing or the anonymous share page
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/app/org/[slug]/executive/page.tsx:58` (also `src/app/share/briefing/[token]/page.tsx:19`)
- **Scenario**: The context is described as branding "applied to dashboards, briefings and PDF exports", and the settings copy promises "your name, accent, and logo replace Ascent's". In reality branding is consumed only by `BriefingDocument` (the PDF) and the download filename. `executive/page.tsx` loads `getOrgBranding` solely to prefill the settings form; the rendered briefing page itself uses Ascent defaults. Worse, the anonymous share page (`/share/briefing/[token]`) — the artifact a reseller actually hands a client — explicitly renders the Ascent brand mark and a "shared briefing" label.
- **Root cause**: EXEC-5 was implemented PDF-first and never decided (or recorded) whether the web briefing and the share view are inside the white-label boundary; the settings-form copy and the context description weren't reconciled with the shipped scope.
- **Impact**: A Team-plan reseller who pays specifically to hide Ascent from clients still exposes "Ascent" on every shared briefing link and on the in-app briefing they screen-share. The feature under-delivers its stated (and sold) promise, and the mismatch is invisible until a client sees the link.
- **Fix sketch**: Decide and record the boundary. Minimum: apply `brandName`/`brandColor`/logo to the share-token page (it's the client-facing deliverable and the org is known from the token), and change the settings copy from "briefing" to "briefing PDF" if the web views stay unbranded. Add a code comment in `executive/page.tsx` stating why the on-screen briefing intentionally keeps Ascent chrome, if that's the decision.

## 2. Accent colour can never be un-set: the picker's `#2563eb` default is silently persisted on first save
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/components/org/executive/BrandingSettings.tsx:44`
- **Scenario**: `brandColor` state initializes to `initial.brandColor ?? "#2563eb"` and `save()` always submits it. An owner who only types a brand name and hits Save also persists `brandColor: "#2563eb"` — a value they never chose. From then on there is no way back to null through this UI: `<input type="color">` cannot express "empty", and the server treats only empty/whitespace as a deliberate clear (`branding.ts:66`). Name and logo are clearable (delete the text); colour is a one-way door.
- **Root cause**: A visible-picker default was conflated with the stored value. It happens to equal the PDF's `ACCENT` fallback (`src/lib/pdf/theme.tsx:13`), so it's cosmetically harmless *today*, but the coupling is accidental and unrecorded — change either constant and orgs that "never picked a colour" diverge from the default.
- **Impact**: DB state no longer distinguishes "org chose the Ascent blue" from "org never chose a colour"; the `null → use current default` semantics the schema was designed for are unreachable once anyone saves. Future default-accent changes won't propagate to those orgs.
- **Fix sketch**: Track a separate `colorTouched`/`colorEnabled` flag: submit `brandColor: ""` (clear) unless the user actually interacted with the picker or `initial.brandColor` was set, and add a small "Use default" / clear affordance next to the swatch. Document that `#2563eb === ACCENT` (import it) instead of duplicating the literal.

## 3. Logo URL is truncated to 500 chars *after* SSRF validation, silently corrupting long-but-valid URLs
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/lib/db/branding.ts:64`
- **Scenario**: `logoUrl` is validated with `isSafeLogoUrl(input.logoUrl.trim())` on the full string, then persisted as `.trim().slice(0, 500)`. A safe 600-char signed-CDN URL (SAS/pre-signed URLs routinely exceed 500 chars) passes validation, gets its query string chopped, is stored as a now-broken URL, and `rejected` stays empty — the form shows a green "Saved".
- **Root cause**: The 500 cap is an undocumented storage guard bolted on after validation; truncate-vs-reject was never decided for this field (contrast `brandName`, where truncation is deliberate and the client warns about it).
- **Impact**: The breakage only surfaces at PDF render time, where `resolveSafeLogoDataUri` fails and the logo is silently dropped — the owner sees "Saved", then ships unbranded PDFs with no error anywhere. Also a latent SSRF-shape hazard: the validated string and the stored string differ.
- **Fix sketch**: Validate the *stored* value: if `trimmed.length > 500`, push `"logoUrl"` into `rejected` and store null instead of slicing. Name the constant (`MAX_LOGO_URL_LEN = 500`) with a comment on why 500.

## 4. No logo preview or reachability check — a wrong-but-safe URL fails invisibly at PDF render
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/org/executive/BrandingSettings.tsx:111` (render-time drop: `src/app/api/org/briefing/pdf/route.ts:60-70`)
- **Scenario**: The form accepts any public https URL; whether it actually serves a fetchable image is never checked at save time and never shown. At export, `resolveSafeLogoDataUri` failure drops the logo, and a branded-render failure falls back to a fully unbranded PDF — both silently (only a server-side `console.error` in the second case). The owner's only "test" is downloading a PDF and eyeballing it.
- **Root cause**: Validation was scoped to safety (SSRF/https), not correctness; the form has no feedback state for "URL saved but not a usable image", and the PDF route's graceful degradation has no user-visible channel.
- **Impact**: The most common real-world failure (typo'd path, HTML page instead of an image, hotlink-protected asset) produces a green "Saved" and then Ascent-branded or logo-less client deliverables — the exact outcome the feature exists to prevent.
- **Fix sketch**: On save (or on blur), have the API run `resolveSafeLogoDataUri` once and warn via the existing `rejected`/warning channel ("URL saved but didn't return an image"); render a small `<img>` preview thumbnail next to the field so success is visible. Reuses the existing warn state — no new UI pattern.

## 5. Picker-only accent entry: brand hexes can't be typed, and the server's hex-rejection path is unreachable dead UX
- **Severity**: Low
- **Category**: component-extraction
- **File**: `src/components/org/executive/BrandingSettings.tsx:101-107`
- **Scenario**: Real white-label users arrive with an exact brand hex from a style guide, but the only input is `<input type="color">` — pasting `#e11d48` isn't possible; they must eyeball-match in the OS picker. Meanwhile `HEX_COLOR_RE` validation, the server's `rejected: ["brandColor"]` branch, and the client warning "Accent colour ignored — must be a #rrggbb hex" (line 66) can never fire from this UI, since the picker only emits valid `#rrggbb`.
- **Root cause**: The input widget was chosen for validity guarantees, but the validation/warning machinery was built for free-text entry — two halves of two different designs.
- **Impact**: Imprecise brand colours in paying customers' deliverables (the one field where exactness is the point), plus dead warning code that misleads future readers about how the form behaves.
- **Fix sketch**: Pair the swatch with a small monospace hex text field (the app already has the `field` input style) kept in two-way sync — pattern seen in every brand-settings UI; the existing contrast advisory and server-side hex validation then become live and meaningful.
