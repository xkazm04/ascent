# Code Refactor — People & Delivery Analytics
> Total: 4 | Critical: 0 High: 0 Medium: 1 Low: 3

## 1. Org-page scope shell (preamble + ScopeFilterBar prop-spread) duplicated across all three pages and siblings
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/contributors/page.tsx:180-187, src/app/org/[slug]/teams/page.tsx:126-142, src/app/org/[slug]/delivery/page.tsx:38-62
- **Scenario**: Every one of the three pages opens with the identical preamble — `const { slug } = await params; const sp = await searchParams; const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);` — and then wires the resolved scope into the filter bar with the **same verbatim 4-prop spread** `<ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} ... />`. The pattern repeats in the sibling pages too: `org/[slug]/page.tsx`, `org/[slug]/passports/page.tsx`. Notably `passports/page.tsx:52-56` does not even call `ScopeFilterBar` — it re-implements the component's exact body inline (`{segments.length > 0 && <SegmentSelector .../>}` + `<TechStackSelector .../>`), a second copy of logic the shared component already owns.
- **Root cause**: `resolveOrgScope` deduped the *data* resolution and `ScopeFilterBar` deduped the *render*, but the **glue between them** (destructure all five fields, then re-list four of them as props) was never consolidated, so each page re-threads the same scope object by hand and the wiring has drifted (passports bypasses the component entirely).
- **Impact**: Adding/renaming a scope field (e.g. a third filter) means editing the prop-spread in 5 call sites plus the hand-rolled passports copy; easy to miss one (passports already diverged). More boilerplate per page than necessary.
- **Fix sketch**: Either (a) have `resolveOrgScope` return a ready-to-spread `barProps: { segments, segmentId, techGroups, activeStack }` bundle so each page does `<ScopeFilterBar {...scope.barProps} />`, or (b) give `ScopeFilterBar` a single `scope={scope}` prop and destructure internally. Then convert `passports/page.tsx` to use `ScopeFilterBar` instead of its inline selector pair, deleting that duplicate.

## 2. teams page hand-rolls the `TILE_GRID` constant string instead of importing it
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/org/[slug]/teams/page.tsx:167
- **Scenario**: The summary-tiles wrapper is written as `<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">`. That class string after `mt-6` is character-for-character the exported `TILE_GRID` constant (`src/components/org/ui.tsx:36` = `"grid gap-4 sm:grid-cols-2 lg:grid-cols-4"`), which exists precisely so every tab's tile grid shares one rhythm. Seven sibling pages (contributors, adoption, governance, executive, security, passports, root) correctly use the constant; teams does not (it does not even import it).
- **Root cause**: The `TILE_GRID` constant was introduced after teams was written, and teams was not migrated. Pure drift from the canonical token.
- **Impact**: If the canonical tile grid changes (e.g. to `xl:grid-cols-4`), teams silently keeps the old layout — the exact failure mode the constant was meant to prevent.
- **Fix sketch**: Import `TILE_GRID` from `@/components/org/ui` and replace the literal with `className={`mt-6 ${TILE_GRID}`}` (matching contributors:210). (Out of scope but same fix: `tech-stacks/page.tsx:94`, `segments/page.tsx:127` hand-roll the same string.)

## 3. Same scope-bar local is named three different ways; `segmentBar` is a stale name
- **Severity**: Low
- **Category**: naming
- **File**: src/app/org/[slug]/teams/page.tsx:134, src/app/org/[slug]/delivery/page.tsx:51, src/app/org/[slug]/contributors/page.tsx:187
- **Scenario**: The exact same concept — the rendered `<ScopeFilterBar>` element held in a local — is named `segmentBar` in teams and delivery, `filterBar` in contributors, and `scopeBar` in the sibling passports page. The `segmentBar` name is stale: the bar renders the **segment AND tech-stack** selectors (the component was renamed to `ScopeFilterBar`), so "segment" undersells it — and the teams comment one line up (teams:129) already calls it "segment + tech-stack scope."
- **Root cause**: The bar grew a tech-stack selector and was renamed, but the per-page variable names were never reconciled, leaving three names for one thing.
- **Impact**: Confusion when reading across the org pages — a grep for the filter bar misses two of three names; the stale `segmentBar` misleads about what the bar contains.
- **Fix sketch**: Standardize on one name (`scopeBar` matches the `ScopeFilterBar` component and the passports page) across teams, delivery, and contributors.

## 4. contributors `hasFilters` re-derives ScopeFilterBar's built-in `gate`
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/org/[slug]/contributors/page.tsx:186-187, 193, 206
- **Scenario**: The page computes `const hasFilters = segments.length > 0 || techGroups.length > 0;` then `const filterBar = hasFilters && <ScopeFilterBar ... />`, and guards two render sites with `{filterBar && <div ...>{filterBar}</div>}`. But `ScopeFilterBar` already encapsulates exactly this decision via its default `gate` (ui/ScopeFilterBar.tsx:31: `if (gate && segments.length === 0 && techGroups.length === 0 && !children) return null`). So `hasFilters` re-implements the component's own empty-check.
- **Root cause**: The page needs to know whether the bar will render in order to skip its surrounding wrapper `<div>`s, so it duplicated the gate condition rather than relying on the component (which only knows to return `null`, not to suppress the parent's wrapper).
- **Impact**: The empty-when-no-filters rule now lives in two places; if the gate condition changes (e.g. counts children), contributors' `hasFilters` won't track it. Minor, but it is logic the component already owns.
- **Fix sketch**: Drop `hasFilters` and derive the bar once; either let `ScopeFilterBar` render its own `null` (accepting the empty wrapper) or expose a tiny `scopeHasFilters(scope)` helper in `@/lib/org/scope` shared by both the page and the component so the rule has a single source.
