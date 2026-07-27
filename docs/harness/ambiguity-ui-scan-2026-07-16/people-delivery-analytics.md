# People & Delivery Analytics — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Export CSV link is a dead URL on all three pages (backslashes in template literal)
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/org/shared/ui.tsx:289` (rendered by `src/app/org/[slug]/contributors/page.tsx:74`, `teams/page.tsx:97`, `delivery/page.tsx:61`)
- **Scenario**: `ExportCsvLink` builds `` const href = `\api\org\export?...` ``. In a JS template literal `\a`, `\o`, `\e` are unrecognized escapes that resolve to the bare character, so the string becomes `apiorgexport?org=...` — a *relative* URL with no leading slash. From `/org/acme/delivery` the browser resolves it to `/org/acme/apiorgexport?...` → 404. Every "Export CSV" affordance in Contributors, Teams, and Delivery is broken.
- **Root cause**: Windows-path-style backslashes typed (or sed-substituted) into what must be `/api/org/export`; no test or lint catches useless string escapes here.
- **Impact**: A visible, promised feature (the per-person CSV even gets its own opt-in framing on Contributors) hard-404s for every user; erodes trust in the whole analytics surface.
- **Fix sketch**: `` const href = `/api/org/export?org=...` ``. Add a unit test asserting the rendered `href` starts with `/api/org/export`, and enable ESLint `no-useless-escape`/`no-nonoctal-decimal-escape`-class checks to flag stray backslash escapes.

## 2. CSV export silently ignores the tech-stack filter the page honors
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/org/shared/ui.tsx:278-289` (call sites `contributors/page.tsx:74`, `teams/page.tsx:97`, `delivery/page.tsx:61`)
- **Scenario**: All three pages compose two scopes — segment AND tech stack (`resolveOrgScope` returns both, and the queries pass both). `ExportCsvLink` accepts and forwards only `segmentId`; `techGroupId` is dropped. With a stack filter active, the screen shows the filtered subset while the exported CSV is segment-only (or whole-fleet), with no hint of the discrepancy.
- **Root cause**: The tech-stack scope was added to the pages (comments call out "the two filters compose") but the export link's contract was never extended; the assumption "export matches what I see" is unstated and false.
- **Impact**: A leader filters Delivery to one stack, exports, and circulates numbers for the whole fleet — exactly the mis-scoped-figures class the page's own Finding A comment (delivery/page.tsx:44-53) works hard to prevent for dollars.
- **Fix sketch**: Add `techGroupId` to `ExportCsvLink` props and the query string (`&stack=`), honor it in the export route; until then, hide the link (or label it "whole fleet") when `techGroupId` is set — mirroring the withhold-allocated-ROI pattern already used on this page.

## 3. Concentration table's accessible caption describes a different table
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/app/org/[slug]/contributors/page.tsx:148`
- **Scenario**: `ConcentrationTable` passes `caption="AI-commit adoption by repository"` to `OrgTable`, which renders it as the sr-only `<caption>` — the table's accessible name. The table is actually "Concentration & bus factor" (contributors, top share, bus factor, key-person decisions); the caption text is copy-pasted from an adoption table.
- **Root cause**: Caption copied when the shared `OrgTable` caption prop was rolled out; sighted review can't see sr-only text, and nothing ties the caption to the adjacent `SectionHeader` title.
- **Impact**: Screen-reader users navigating by table get a name that contradicts the content — worse than no caption, since it actively misdirects (there IS an adoption-by-repo table elsewhere in the app).
- **Fix sketch**: `caption="Commit concentration and bus factor by repository"`. Consider having `OrgTable` call sites derive the caption from the section title to keep them from drifting.

## 4. "AI champions" ranking doesn't match its on-screen definition; eligibility floor undocumented
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/lib/db/org-contributors.ts:98,141-145` (rendered at `contributors/page.tsx:23`)
- **Scenario**: The UI says champions are "Highest AI adoption across the most repos", but the actual ranking is `championScore = (aiShare/100) × √repos × log₂(commits+1)` — commit *volume* is a third factor, so a 60%-AI-share prolific committer can outrank a 95%-share specialist. Eligibility (`commits >= 3 && aiCommits > 0`) and the `limit: 6` cap are bare magic numbers with no comment, in sharp contrast to `CHAMPION_MIN_POP`, which earned a 5-line rationale in `champions.ts` precisely because who-gets-named matters here.
- **Root cause**: The score formula got a one-line "AI adoption × breadth × (log) volume" note, but the volume term never made it into the user-facing description, and the eligibility thresholds were never given the recorded reasoning this feature demands of itself.
- **Impact**: People are publicly named/ranked (`#1 ★`) by criteria that differ from the stated ones — the exact "surveillance-y ranking" failure mode the codebase's own comments warn about; also makes the threshold impossible to tune deliberately.
- **Fix sketch**: Update the ChampionsGrid description to "...weighted by breadth and activity", and move `MIN_CHAMPION_COMMITS = 3` / `CHAMPION_LIMIT = 6` next to `CHAMPION_MIN_POP` in `champions.ts` with a one-line rationale each.

## 5. Contributors summary tiles don't deep-link to evidence (Teams tiles do); concentration section has no anchor
- **Severity**: Low
- **Category**: visual-inconsistency
- **File**: `src/app/org/[slug]/contributors/page.tsx:241-246` (contrast `teams/page.tsx:71-89`)
- **Scenario**: Teams' tile ledger deep-links every stat to its evidence (`href="#teams-matrix"`, `#unowned`, per-team anchors) and its comment calls this the pattern ("each stat deep-links to its evidence"). Contributors renders the same `Tile`/`TILE_GRID` band with zero `href`s — notably the warn-colored "Solo-maintainer repos" tile, whose evidence (Concentration & bus factor + DecisionControl) sits two folds down and has no `id` anchor to link to.
- **Root cause**: The deep-link affordance was added on Teams after the Contributors band was built; the sibling tab was never brought to parity.
- **Impact**: Inconsistent interaction model between adjacent tabs sharing one visual component — a warn tile on Teams is clickable, the same-looking warn tile on Contributors is inert, so users stop trying; the key-person-risk workflow (tile → decide) loses its shortcut.
- **Fix sketch**: Give the concentration section `id="concentration"` (and champions/individuals anchors), then add `href` to the four tiles ("Solo-maintainer repos" → `#concentration`, "Contributors"/"AI-active" → the individuals `<details>`, auto-opening it via `#` target CSS or a tiny client hook).
