# PDF & LLM Export — bug-hunter + ui-perfectionist scan

> Context: PDF & LLM Export (group: Reporting & Visualization)
> Files scanned: 5
> Total: 7 findings (Critical: 0, High: 1, Medium: 2, Low: 4)

## 1. PDF export resolves the readable org via the DORMANT custom-OAuth session
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dormant-gating
- **File**: src/app/api/report/pdf/route.ts:28
- **Scenario**: Under the active Supabase login wall, a Private-tier customer opens `GET /api/report/pdf?repo=acme/secret` for their OWN private repo. `readableOrgForOwner(parsed.owner)` calls `getSession()` — the custom GitHub-OAuth session, which is dormant under the Supabase wall — so it returns null installations and falls back to `"public"`. `getScanReportByCommit(..., { orgSlug: "public" })` then hits the defense-in-depth guard `scans-read.ts:780` (`orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate → null`) and 404s "No saved scan… Scan it first."
- **Root cause**: The org resolver reads a legacy session that is never issued under the production auth wall — the exact bug the sibling `recommendations/route.ts:32-41` already fixed by switching to `canReadOrg(ownerOrg)`. The passport routes share the same unfixed pattern.
- **Impact**: The paid "PDF export" is permanently broken for the private repos it is sold for; no leak (guard holds), but a total feature lockout for Private-tier users.
- **Fix sketch**: Mirror recommendations: `const ownerOrg = parsed.owner.toLowerCase(); const orgSlug = (await canReadOrg(ownerOrg)) ? ownerOrg : PUBLIC_ORG;` then `requireOrgRead(orgSlug)` as today.

## 2. Copy button's success/failure is invisible to screen readers
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/CopyForLlm.tsx:65
- **Scenario**: A screen-reader user activates "Copy for LLM". The button's accessible name is pinned by `aria-label={ariaLabel ?? label}` (static), so it always reads "Copy for LLM" even after the visible text flips to "Copied"/"Copy failed" — `aria-label` overrides the text content. The `aria-live="polite"` on line 66 never fires because the accessible name never changes.
- **Root cause**: Assumption that a static `aria-label` + `aria-live` on the control announces state; in fact the live region only speaks when its content changes, and the label freezes it.
- **Impact**: Blind users get no confirmation a copy happened (or failed on plain-HTTP where both clipboard paths fail) — they may paste stale content.
- **Fix sketch**: Drop `aria-live` from the button; render a separate visually-hidden `<span role="status" aria-live="polite">` that receives "Copied"/"Copy failed", OR make `aria-label` reflect the state.

## 3. PDF uses built-in Helvetica — non-Latin-1 glyphs silently drop
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/pdf/report-document.tsx:23
- **Scenario**: A repo owner/name with CJK/Cyrillic/emoji, or an LLM-generated `headline`/dimension `summary` containing an emoji or non-Latin1 symbol, is rendered with `fontFamily: "Helvetica"` (the doc header notes "built-in Helvetica, no font registration"). @react-pdf's standard fonts only carry WinAnsi/Latin-1 glyphs, so those characters render as blank/notdef boxes (line 67 `ref`, 77 `headline`, 131 `summary`).
- **Root cause**: Assumption that the deliverable content is Latin-1; owner names and LLM prose are not.
- **Impact**: International repos / AI-written summaries produce a paid PDF with missing text — a correctness + credibility hit, silent (no error).
- **Fix sketch**: Register a Unicode TTF (e.g. Noto Sans) via `Font.register` and set it as the page font, or transliterate/strip to a documented Latin subset.

## 4. `passports` export branch lacks the null-guard its three siblings carry
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/org/export/route.ts:57
- **Scenario**: `getOrgRollup` returns null (e.g. `!isDbConfigured`/`!org`) and the code does `(rollup?.repos ?? [])` → a header-only CSV with a 200. The `contributors`, `teams`, and `delivery` branches all explicitly 404 on null with the "success theater" comment; `passports` silently diverges from that contract.
- **Root cause**: Copy-drift — the optional-chain default swallows the "lookup unavailable" case the other branches reject.
- **Impact**: A transient/edge null yields an empty-looking-but-200 export instead of an honest 404; low real-world hit rate because `requireOrgRead` already vetted the org.
- **Fix sketch**: `const rollup = await getOrgRollup(...); if (!rollup) return NextResponse.json({ error: "No analytics for this org yet." }, { status: 404 });` before building rows.

## 5. CSV formula-guard mangles legitimate negative numbers
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: data-correctness
- **File**: src/app/api/org/export/route.ts:85
- **Scenario**: The `teams` CSV emits `t.avgDelta` (since-last-scan maturity movement), which is negative for a declining team. `csvField` (csv.ts:25) neutralizes any cell starting with `= + - @`, so `-3.2` becomes the quoted text `"'-3.2"`. Excel/Sheets then treat that column as text, breaking sort/sum/AVERAGE on `avgDelta`.
- **Root cause**: The injection guard's leading-`-` rule is too broad — it can't distinguish a numeric literal from a formula.
- **Impact**: Analysts can't aggregate the negative numeric columns of the export; the shared helper affects every CSV route emitting negative numbers.
- **Fix sketch**: In `csvField`, only neutralize when the value is non-numeric: skip the `'` prefix when `!Number.isNaN(Number(s))` (a pure number can't be a formula). Fix in the shared helper; this route just exposes it.

## 6. Long unbroken `owner/name` overflows the report H1
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: responsiveness
- **File**: src/lib/pdf/report-document.tsx:67
- **Scenario**: `ref = owner/name` (up to ~140 unbroken chars, GitHub limits) is rendered at `fontSize: 22` (styles.h1, line 25) with no whitespace to wrap on, so a long org+repo runs past the 48pt page margin and clips at the page edge.
- **Root cause**: Assumption that the single-token title always fits one line.
- **Impact**: Cosmetic clipping on the flagship page of the paid PDF for long repo slugs.
- **Fix sketch**: Reduce/auto-scale h1 for long refs, or insert a soft break after `/` (render owner and name as separate wrapping `Text`), and/or lower the font size when `ref.length` is large.

## 7. PDF route sets no `maxDuration`
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/app/api/report/pdf/route.ts:17
- **Scenario**: Every sibling heavy route (`scan`, `org/scan`, `gate`, `report/passport/pr`, …) exports a `maxDuration`; this one does not, so `renderToBuffer` runs under the platform default (as low as 10s on a constrained plan). A large multi-page report under load times out as an opaque platform 504 instead of the route's clean handled `500 "Failed to render the PDF."`.
- **Root cause**: Missing explicit budget; render cost is treated as always-tiny.
- **Impact**: Occasional opaque gateway timeouts with no route-level error the client can display.
- **Fix sketch**: Add `export const maxDuration = 60;` alongside the existing `runtime`/`dynamic` exports.
