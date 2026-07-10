# Code Refactor — Executive Briefing
> Total: 5 | Critical: 0 High: 2 Medium: 2 Low: 1

## 1. PDF document scaffolding duplicated across all three @react-pdf documents
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/pdf/briefing-document.tsx:16-63, src/lib/pdf/security-document.tsx:9-47, src/lib/pdf/report-document.tsx:9-49
- **Scenario**: Three separate PDF document modules each redeclare the same theme tokens and helpers from scratch:
  - The palette `ACCENT="#2563eb"`, `INK`, `MUTED`, `FAINT`, `LINE` is copy-pasted verbatim in all three (briefing 16-20, security 9-13, report 9-13).
  - `scoreColor(s)` — the identical `>=80 green / >=60 accent / >=40 amber / else red` tier function — appears verbatim in all three (briefing 22-27, security 15-20, report 15-20).
  - The `styles` objects share `page`, `kicker`, `rule`, `sectionH`, and `footer` definitions verbatim; briefing + security additionally share `statsRow`, `stat`, `statLabel`, `statVal`, `statSub`.
  - The `Stat` sub-component is byte-for-byte identical in briefing-document (55-63) and security-document (39-47).
  - The fixed footer block (`<View style={styles.footer} fixed>` … `<Text render={({pageNumber,totalPages}) => …} />`) is identical in all three (briefing 179-182, security 110-113, report 128-131).
- **Root cause**: Each PDF was authored by copy-pasting the previous one (security-document's header comment literally says "Mirrors briefing-document.tsx's light theme"). No shared PDF theme/primitives module exists (`src/lib/pdf/` contains only the three documents + a test).
- **Impact**: A palette tweak, a footer change, or a score-threshold change must be made in three places and is easy to let drift; ~80 lines of redundant style/helper code; new PDF documents will copy the same boilerplate again.
- **Fix sketch**: Add `src/lib/pdf/theme.ts` (or `pdf-kit.tsx`) exporting the shared color constants, `scoreColor`, the shared `StyleSheet` fragments (page/kicker/rule/sectionH/footer/stat*), and the `Stat` + `Footer` components. Import them into all three documents and delete the local copies. Keep document-specific styles (e.g. report's `scoreNum`, briefing's `twoCol`) local.

## 2. Share-token sign/verify flow near-duplicated between briefing-share.ts and live-share.ts
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/briefing-share.ts:8-81, src/lib/live-share.ts:7-52
- **Scenario**: `briefing-share.ts` and `live-share.ts` implement the same HMAC capability-token scheme with near-identical code: `shareSecret()` (dedicated env var `|| AUTH_SECRET || "" → null`), `sign(payload, secret)` (`createHmac("sha256").update().digest("base64url")`), the `xShareEnabled()` boolean, and the verify routine (`lastIndexOf(".")`, slice payload/sig, `timingSafeEqual` length-guarded compare, base64url JSON parse, `exp < Date.now()` expiry check). briefing-share's own header comment says "Mirrors lib/live-share.ts (WAR-4)."
- **Root cause**: The briefing share flow was built by cloning the live-share module and adding window/segment/stack fields to the payload; the cryptographic core was copied rather than shared.
- **Impact**: The signing/verification primitives (the security-sensitive part) live in two places — a fix to the timing-safe comparison, the secret-resolution fallback, or the token format must be mirrored or the two silently diverge; ~40 lines duplicated.
- **Fix sketch**: Extract a generic `src/lib/share-token.ts` with `makeShareToken<T>({ secretEnvVar })` returning `{ enabled, sign(payload: T, ttlMs), verify(token): T | null }`, encapsulating secret resolution, HMAC sign, and the timing-safe verify+expiry. Have `briefing-share.ts` and `live-share.ts` each instantiate it with their env var and payload shape, keeping only their payload typing/normalization. (Behavior-preserving; both modules have tests — `briefing-share` is exercised via routes/pages, `live-share.test.ts` exists — so run them after.)

## 3. PDF export route preamble and response are duplicated across the three /pdf routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/briefing/pdf/route.ts:20-68, src/app/api/org/security/pdf/route.ts:22-48, src/app/api/report/pdf/route.ts:20-64
- **Scenario**: The three PDF routes repeat the same skeleton: `isDbConfigured()` 503 guard, read `?org`/`?repo` + missing-param 400, `requireOrgRead` gate, build…`.catch(() => null)` → 404, `createElement(Doc, props) as unknown as ReactElement<DocumentProps>` cast, `renderToBuffer`, then an identical response:
  ```
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
  ```
  briefing/pdf and security/pdf are nearly line-for-line identical (same `resolveWindow({range,from,to})` + `resolveStackScope` preamble); the closing response block is identical in all three; the `createElement(... ) as unknown as ReactElement<DocumentProps>` cast pattern and the `console.error(...) → 500` render-failure wrapper recur (briefing 55-58, report 49-53).
- **Root cause**: Each route was cloned from the previous (security/pdf comment: "Mirrors the briefing PDF route") with no shared PDF-response helper.
- **Impact**: Cache policy, content headers, the render-failure handling, and the `DocumentProps` cast must be kept in sync by hand across three routes; ~20+ duplicated lines.
- **Fix sketch**: Add a small helper, e.g. `pdfResponse(buffer, filename)` in `src/lib/export/` (returns the `NextResponse` with the shared headers) and a `renderPdfBuffer(element)` wrapper that does the `as unknown as ReactElement<DocumentProps>` cast + try/catch → null. Routes keep only their auth/build/filename specifics.

## 4. Exec page and public share page still duplicate the Strengths/Weakest/Goals/Tiles blocks
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/executive/page.tsx:82-99,192-246 vs src/app/share/briefing/[token]/page.tsx:63-68,84-118
- **Scenario**: `briefingShared.tsx` was created specifically to de-dup the two briefing renderers (its header comment: "The share page was assembled by copy-pasting render blocks out of the executive page") and it extracted `DimRow` + `PriorPeriodGrid` — but the extraction stopped there. The **Strengths** card, the **Weakest dimensions** card, the **Goals** card, and the 4-tile **TILE_GRID** header are still copy-pasted inline in both pages. The Strengths card (page 193-200 vs share 85-92) is byte-identical; the Goals card (page 228-246 vs share 103-118) differs only in empty-state text; the Tiles grid differs only by the first tile's `delta`/`deltaLabel` props.
- **Root cause**: Partial refactor — the shared-component extraction covered the two trickiest blocks (which had drifted) but left the straightforward Card blocks duplicated.
- **Impact**: A change to how strengths/weakest/goals/tiles render must be made twice and can drift between the authenticated and public views (the kind of drift the briefingShared module was created to stop).
- **Fix sketch**: Move the Strengths card, Weakest-dimensions card (with the optional D9-security fallback row as a prop), Goals card (empty-state text as a prop), and the maturity Tiles grid into `briefingShared.tsx` as `StrengthsCard`/`WeakestCard`/`GoalsCard`/`MaturityTiles` and render them from both pages.

## 5. Dimension-name resolution expression duplicated inside briefing.ts
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/org/briefing.ts:143, src/lib/org/briefing.ts:211
- **Scenario**: The label lookup `DIMENSION_BY_ID[d.dimId as DimensionId]?.name ?? d.dimId` is written twice — once in the `named()` helper (143) and once inline in the `priorPeriod.dims` mapping (211).
- **Root cause**: `named()` returns `{dimId,label,avg}` while the priorPeriod map needs `{dimId,label,now,prior,delta}`, so the author re-inlined the same label expression rather than factoring the shared part.
- **Impact**: Minor — if the fallback or dimension-name source changes, both sites must change; tiny but avoidable drift surface.
- **Fix sketch**: Extract a one-liner `const dimName = (id: string) => DIMENSION_BY_ID[id as DimensionId]?.name ?? id;` and call it from both `named()` and the priorPeriod dims map.
