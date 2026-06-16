# Usage Metering & Public Badge — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 9

Scope: the public SVG badge route is the headline attack surface (unauthenticated, embeds user-controlled `owner`/`repo`/`?label`/`?logo`/`?color` into served SVG). The XSS hardening is mostly solid — `esc()` covers `& < > "`, all attributes are double-quoted, `color` is whitelisted by `resolveColor`, `href` is built only from `[A-Za-z0-9_.-]`-validated names, and `label` is escaped at every sink. The remaining gaps are the `data:image/svg+xml` logo vector, an `esc()` completeness gap, and cache-control directives on the neutral/error paths. UI findings center on the badge generator copy/preview UX.

## 1. `?logo=data:image/svg+xml,…` is accepted and embedded into the served SVG (active-SVG XSS vector)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: XSS / injection — public SVG endpoint
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:228-229 (gate) and :151-152 (sink)
- **Scenario**: An attacker crafts a badge URL `…/api/badge/facebook/react?logo=data:image/svg+xml;base64,<payload>` (or `data:image/svg+xml,<svg onload=…>`), where the payload is an SVG carrying script/`onload`. The gate at :229 only checks `logoParam.startsWith("data:image/")` and a length cap — `image/svg+xml` passes. It is then placed verbatim (only HTML-attr-escaped) into `<image … href="${esc(opts.logo)}"/>` at :152, inside a document the route serves as `Content-Type: image/svg+xml`. The route is explicitly designed to be loaded as a top-level navigable SVG (the `<a xlink:href>` wrapper at :171-172 exists "when the SVG is loaded directly, not via `<img>`"), so a victim opening/clicking the link loads an active SVG document that pulls in attacker SVG.
- **Root cause**: The allowlist gates on the `data:image/` prefix but does not exclude the one image subtype that is itself an active, scriptable document (`svg+xml`). `esc()` correctly prevents attribute breakout, so the data URI survives intact into the `href`.
- **Impact**: Script execution / clickjacking in the badge's origin when the badge is opened as a document (and a stepping stone for embedding contexts that render SVG inline rather than via `<img>`). On a public, unauthenticated, indefinitely-shareable URL this is a wormable reflected-XSS-style link.
- **Fix sketch**: Restrict the logo allowlist to raster subtypes (e.g. `data:image/png;base64,` / `data:image/jpeg;base64,` / `data:image/gif;base64,`) and reject `svg+xml`; ideally require `;base64,` and validate the base64 body. Belt-and-suspenders: add `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff` to the badge response.

## 2. Customized "unknown"/"private"/validation-fail badges are served with a PUBLIC (`s-maxage`) cache directive
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: cache-control / CDN cross-consumer leak
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:248-249, :255-256, :304-305 (use `CACHE_NEUTRAL`); contrast :238 + :327/:336/:350
- **Scenario**: The resolved-badge paths correctly downgrade a query-customized body to `CACHE_CUSTOM = "private, max-age=600"` via the `customized` flag (:238) so a path-keyed CDN can't serve one caller's `?label=`/`?color=`/`?logo=` variant to another. But the early-return paths — invalid name (:249), negative cache (:256), and private repo (:305) — always pass `cache: CACHE_NEUTRAL = "public, max-age=30, s-maxage=30"`, ignoring `customized`. So `…/api/badge/Foo/Bar?label=<custom>&color=red` that resolves to "unknown"/"private" is emitted with a shared, `s-maxage` cache directive keyed on path alone.
- **Root cause**: The `customized ? CACHE_CUSTOM : …` branch was applied only to the three success returns, not to the neutral/validation/negative-cache returns, which hard-code `CACHE_NEUTRAL`.
- **Impact**: A shared CDN/proxy can cache and replay one consumer's customized neutral badge body to other consumers for the public TTL — wrong label/color served cross-tenant, and a vector to poison a popular badge path's edge entry with attacker-chosen `?label`/`?logo` content. Lower-impact than #1 (these bodies are neutral, not resolved levels) but it's a public-cache correctness hole.
- **Fix sketch**: Thread `customized` into the neutral paths too: `cache: customized ? CACHE_CUSTOM : CACHE_NEUTRAL` on the :249/:256/:305 returns (and the :362 catch path already uses `no-store`, which is fine).

## 3. `esc()` omits the single quote (and isn't applied to numeric/derived SVG fields) — latent injection hardening gap
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: XSS hardening / defense-in-depth
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:69-71
- **Scenario**: `esc()` replaces `& < > "` but not `'`. Today every attribute in `badgeSvg` is double-quoted so no live breakout exists, but the function is the project's single SVG-escaping primitive and is one refactor (a single-quoted attribute, or reuse in another SVG builder) away from a real apostrophe-breakout XSS. It also silently relies on every caller wrapping each interpolation in `esc()` — and the numeric/derived fields (`w`, `h`, `lw`, `vw`, `rx`, `ty`, `readableOn(color)`) are emitted raw; they're computed from validated/whitelisted inputs today, so safe, but the invariant is undocumented and brittle.
- **Root cause**: Incomplete entity coverage for the XML attribute context (a complete attribute-safe escaper covers `& < > " '`).
- **Impact**: No current exploit, but the primitive does not fully encode for the XML-attribute context it's used in, making the whole SVG builder fragile to future edits. Worth closing because this is the project's only SVG escaper and the surface is public.
- **Fix sketch**: Add `.replace(/'/g, "&#39;")` (and arguably `/` for completeness) to `esc()`, and add a one-line comment on `badgeSvg` asserting that every caller-derived string MUST pass through `esc()` and numeric fields MUST be numbers.

## 4. Badge generator shows "Copied!" even when nothing was copied (clipboard unavailable / rejected)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: UX / error feedback — false success
- **File**: src/components/badge/BadgeGenerator.tsx:71-76
- **Scenario**: `copy()` calls `navigator.clipboard?.writeText(snippet)` and then unconditionally `setCopied(true)`. In an insecure context (HTTP, some embedded webviews) `navigator.clipboard` is `undefined`, so the optional chain no-ops and nothing reaches the clipboard — yet the button flips to "Copied!" for 1.5s. Likewise `writeText` returns a promise that can reject (permission denied); the rejection is unhandled and the UI still claims success. The user pastes stale/empty content into their README.
- **Root cause**: Success state is set synchronously regardless of whether the copy actually happened; the promise result is ignored.
- **Impact**: Silent data-loss UX on the core action of this growth-loop page — the user believes the embed snippet is on their clipboard when it isn't, with no fallback (e.g. select-the-`<pre>`).
- **Fix sketch**: Gate on the promise: `navigator.clipboard?.writeText(snippet).then(() => { setCopied(true); … }).catch(() => …)`; when `navigator.clipboard` is absent, fall back to selecting the snippet `<pre>` (or `document.execCommand('copy')`) and surface a "copy manually" hint instead of a false "Copied!".

## 5. Badge preview has no loading/broken-image state — a failed badge silently shows a broken `<img>`
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: UX — empty/loading/error states
- **File**: src/components/badge/BadgeGenerator.tsx:129-138
- **Scenario**: The preview renders `<img src={badgeUrl} … className="h-7" />` as soon as `parsed` is truthy. The badge route can legitimately return a neutral/"unknown"/"rate limited" badge (200) or, on transient origin failure, a slow/broken response — and for a typo'd-but-parseable repo the user sees no signal that resolution failed. There is no skeleton while the SVG loads and no `onError` fallback if the image fails entirely, so a mistyped repo or a slow first-scan looks like a blank/broken box rather than "couldn't resolve this repo".
- **Root cause**: The preview assumes the badge image always loads instantly and successfully; no `onLoad`/`onError`/loading affordance.
- **Impact**: On the badge generator's primary feedback element, a failed/slow/unknown lookup is indistinguishable from a bug — undermines trust in the embed before the user copies it. Minor because the badge route is robust and usually returns *something*, but the clarity gap is real on the error path.
- **Fix sketch**: Add a loading shimmer until `onLoad`, and an `onError` handler that swaps to an inline "Couldn't load a badge for this repo — check the owner/name" message; consider distinguishing a resolved level badge from a neutral "unknown" one (e.g. a caption echoing the resolved value).
