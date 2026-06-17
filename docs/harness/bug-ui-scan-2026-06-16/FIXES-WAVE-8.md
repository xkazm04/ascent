# Bug-UI Fix Wave 8 — File-Gen + Injection

> 3 atomic commits, 8 findings closed (7 high, 1 medium) — the security-flavored remainder.
> Baseline preserved: `tsc` 0 → 0 errors · tests 502/502 → 502/502 (no new unit harness for these route/generator paths; verified by `tsc` + diff review).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `6c890d1` fix(api/badge): reject data:svg logos (XSS) + private cache for customized badges | usage-badge #1, #2 | 2×High | `badge/[owner]/[repo]/route.ts` |
| 2 | `792f63f` fix(api/pdf): guard renderToBuffer + sanitize filenames | pdf-llm #1, #2; executive #1 | 3×High | `report/pdf/route.ts`, `org/briefing/pdf/route.ts` |
| 3 | `2d6712c` fix(onboarding/skill): collision-proof fence + sanitized filename/frontmatter | ai-standard #1, #2 (+ frontmatter M) | 2×High + Medium | `onboarding/skill.ts`, `report/skill/route.ts` |

## What was fixed

1. **Badge `data:image/svg+xml` logo XSS (High).** The `?logo=` param accepted any `data:image/*`, including a nested, scriptable SVG that executes when the badge is loaded directly as `image/svg+xml` — on an unauthenticated, publicly-embeddable endpoint. Now only raster types (`png/jpe?g/gif/webp`) are embedded; `svg+xml` is rejected.
2. **Badge customized variants cached publicly (High).** The neutral/error badges (validation-fail, negative-cache, private) were served with the *public* `CACHE_NEUTRAL` directive even when the body was customized by query params, so a CDN could serve one caller's variant to another. They now downgrade to the private `CACHE_CUSTOM` when customized, matching the success paths.
3. **PDF `renderToBuffer` unguarded (2×High).** Both export routes let a `@react-pdf` render failure escape as an unhandled 500 with a raw stack (the report route had no try/catch; the briefing route's final reject was unguarded). Both now catch and return a clean error.
4. **PDF/skill Content-Disposition injection (High).** All three export routes interpolated caller-supplied segments — notably the unvalidated `?repo=…@<sha>` — straight into the `Content-Disposition` filename. All three now sanitize to filename-safe chars.
5. **SKILL.md fence collision (High).** `embedFile` used a fixed four-backtick fence that *assumed* no embedded body contains four backticks — a four-backtick line closed the fence early and leaked/garbled everything below. The fence is now sized to more backticks than the longest run in the body.
6. **Skill frontmatter newline (Medium).** The single-line YAML `description` escaped quotes but not newlines — an interpolated value with a newline could break out of the quoted scalar and corrupt the frontmatter. Now collapses newlines too.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 502/502 | 502/502 |

Note: these are unauthenticated routes + a text generator without existing unit harnesses; the fixes are surgical (a tightened regex, a try/catch, filename sanitization, a dynamic fence) and were verified by `tsc` + diff review. The badge logo regex and the fence length are simple, self-contained transforms.

## Patterns established (catalogue items 19–20)

19. **A "data: image" allowlist must exclude `svg+xml`.** SVG is active content (it runs script); accepting `data:image/svg+xml` anywhere it can be rendered directly (not via `<img>`) is an XSS sink. Allow raster types explicitly; never `startsWith("data:image/")`.
20. **A fixed-length fence/delimiter is a collision waiting to happen.** When wrapping arbitrary content in a fence (markdown code block, a multipart boundary, a heredoc), size the delimiter to be longer than the longest run of the delimiter char *in the content*, or the content can close the wrapper early.

## What remains

Remaining waves per INDEX: **W9 GitHub API resilience** (pagination, 403/429-as-not-found) · W10 accessibility · W11 UI states & consistency. All H/M/L.
