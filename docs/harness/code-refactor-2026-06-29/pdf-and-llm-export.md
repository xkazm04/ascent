# Code Refactor — PDF & LLM Export
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. PDF theme primitives (palette + scoreColor + base StyleSheet + footer) triplicated across the three PDF documents
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/pdf/report-document.tsx:9-49 (also src/lib/pdf/briefing-document.tsx:16-53 + src/lib/pdf/security-document.tsx:9-37)
- **Scenario**: All three PDF documents open with the same hard-coded scaffolding and there is **no shared PDF helper module** (confirmed: `src/lib/pdf/` contains only the three `*-document.tsx` files + tests).
  - Palette constants `ACCENT/INK/MUTED/FAINT/LINE`: report 9-13, briefing 16-20, security 9-13 — byte-identical in all three.
  - `scoreColor(...)` (80→green / 60→accent / 40→amber / else red): report 15-20, briefing 22-27, security 15-20 — identical body (param named `score` in report vs `s` in the siblings, no behavioral difference).
  - Base `StyleSheet.create` keys identical across all three: `page` (report 23 / briefing 32 / security 23), `kicker` (24/33/24), `footer` (48/52/36), `sectionH` (38/44/33). Several more (`statLabel`/`axisLabel`, `statVal`, `statSub`) share the same values under slightly different names.
- **Root cause**: report-document.tsx is the third near-verbatim copy of a "light-theme Ascent PDF" boilerplate; each new export PDF was started by copy-pasting the previous one. This is the same duplication flagged twice before, now confirmed on the report-document side.
- **Impact**: A palette/branding change (e.g. accent color, footer rule, page margins) must be made in three files and silently drifts if one is missed; ~30+ lines of triplicate noise obscures what is actually unique per document.
- **Fix sketch**: Add `src/lib/pdf/theme.ts` exporting the palette consts, `scoreColor`, and a `baseStyles` StyleSheet fragment (`page/kicker/rule/footer/sectionH/stat*`). Have each document `import { ACCENT, scoreColor, baseStyles }` and spread/merge `baseStyles` into its local `StyleSheet.create`, keeping only the per-document style keys. One wave touches all three files plus the new module.

## 2. PDF export route preamble + response tail triplicated across the three `/pdf` routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/report/pdf/route.ts:7-18,21,44,58-64 (also src/app/api/org/briefing/pdf/route.ts:7-18,21,48,62-68 + src/app/api/org/security/pdf/route.ts:9-20,23,39,42-48)
- **Scenario**: Each PDF route repeats the same shape: the `react`/`next/server`/`@react-pdf/renderer` import trio, `export const runtime = "nodejs"` + `dynamic = "force-dynamic"`, the `isDbConfigured()` → 503 guard, a `requireOrgRead(...)` gate, the verbatim render cast `createElement(Doc, props) as unknown as ReactElement<DocumentProps>`, and an identical PDF response block:
  ```
  new NextResponse(new Uint8Array(buffer), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, max-age=300",
  }});
  ```
  (The `private, max-age=300` header alone recurs in 4 routes — confirmed by grep: report/pdf, briefing/pdf, security/pdf, report/skill.) report/pdf and briefing/pdf additionally duplicate the `try { renderToBuffer } catch { console.error(...); 500 }` wrapper near-verbatim.
- **Root cause**: the auth→build→render→respond pipeline was copied per route; only the middle "build the document model" step genuinely differs.
- **Impact**: cross-cutting changes (cache policy, a `Content-Length` header, a uniform render-failure path — note security/pdf at line 40 lacks the try/catch the other two have) must be hand-applied to each route and drift; ~15 boilerplate lines per route.
- **Fix sketch**: Add a `src/lib/pdf/respond.ts` helper, e.g. `renderPdfResponse(element, filename)` that does the `as unknown as ReactElement<DocumentProps>` cast, `renderToBuffer`, the try/catch→500, and builds the `NextResponse` with the three headers. Each route shrinks to: gate → build model → `return renderPdfResponse(createElement(Doc, props), filename)`.

## 3. `Stat` component (and its `stat*` styles) duplicated verbatim between the briefing and security documents
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/pdf/briefing-document.tsx:55-63 (identical copy at src/lib/pdf/security-document.tsx:39-47)
- **Scenario**: The `Stat({ label, value, sub, color })` presentational component is byte-identical in both sibling documents, as are the `statLabel`/`statVal`/`statSub` style keys it reads (briefing 39-41, security 30-32). (report-document.tsx does **not** have `Stat` — it renders an `axisLabel`/`axisVal` row instead — so this is a two-of-three duplication, distinct from finding 1 but fixed by the same shared module.)
- **Root cause**: security-document.tsx was created by copying briefing-document.tsx (its own header comment says "Mirrors briefing-document.tsx's light theme"), carrying `Stat` along.
- **Impact**: any change to the stat tile layout must be mirrored in two files; the component adds to the per-file copy-paste surface.
- **Fix sketch**: Move `Stat` (and the `stat*` style keys) into the shared `src/lib/pdf/theme.ts`/a small `components.tsx` from finding 1; both documents import it. report-document could optionally adopt it for its axes tiles to collapse the third near-variant too.

## 4. CSV table-assembler (`toCsv`) is re-implemented per export route instead of living beside the already-centralized `csvField`
- **Severity**: Low
- **Category**: structure
- **File**: src/app/api/org/export/route.ts:15-17
- **Scenario**: org/export defines a clean generic `toCsv(header, rows)` locally, but the identical "join header, then `rows.map(r => r.map(csvField).join(","))`, join with `\n`" assembly is hand-rolled inline in `history/route.ts` (32, 88), `org/repositories/route.ts` (46), and a UsageSummary-specific `toCsv` in `usage/route.ts` (15). The *cell* encoder `csvField` was already extracted to `src/lib/export/csv.ts` — whose header comment explicitly notes the per-route copies "had drifted" (one was missing the formula-injection guard) — but the *table* assembler was left behind.
- **Root cause**: the consolidation that produced `lib/export/csv.ts` stopped at the cell level; the row/table assembly stayed duplicated.
- **Impact**: the same drift risk that motivated centralizing `csvField` applies to the assembler (e.g. CRLF vs LF line endings, trailing newline, BOM handling could diverge per route); minor but spans ≥3 export routes.
- **Fix sketch**: Promote `toCsv(header: string[], rows: unknown[][])` into `src/lib/export/csv.ts` next to `csvField` and have org/export, history, and org/repositories import it (usage/route can keep a thin wrapper that maps its summary to header/rows). No behavior change.
