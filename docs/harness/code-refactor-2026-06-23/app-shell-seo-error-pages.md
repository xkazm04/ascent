# Code Refactor — App Shell, SEO & Error Pages
> Context group: Onboarding, Shell & AI Standard
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

This context is, on the whole, clean and well-documented: the boundary files (`error.tsx`, `global-error.tsx`, `not-found.tsx`) carry deliberate, well-justified divergences (the self-contained inline-styled global boundary, the chrome-less client `error.tsx` that intentionally avoids `@/lib/auth`), `lib/site.ts` is already the single canonical base-URL resolver, and `EmptyState` / `Logo` are live shared primitives with many consumers. The only meaningful cruft is concentrated in the Open-Graph image routes, where the same brand chrome and fallback card have been copy-pasted across sibling routes.

## 1. Open-Graph brand chrome (`SHELL` + `Brand()` + `↑` mark) duplicated across every OG route
- **Severity**: High
- **Category**: duplication
- **File**: src/app/org/[slug]/opengraph-image.tsx:25-59 · src/app/report/[owner]/[repo]/opengraph-image.tsx:25-59 (siblings, in scope via root + launch) · src/app/opengraph-image.tsx:13-48 · src/app/launch/opengraph-image.tsx:63-82
- **Scenario**: The `SHELL` container-style object (1200×630 flex column, `padding:80`, the `linear-gradient(160deg, #0b1322 0%, #080d1a 62%)` background, `#e2e8f0`/`sans-serif`) and the `Brand()` component (the azure `#3b9eff` rounded `↑` glyph tile + the letter-spaced white `ASCENT` wordmark) are **byte-identical** in `org/[slug]/opengraph-image.tsx` and `report/[owner]/[repo]/opengraph-image.tsx`. The root `opengraph-image.tsx` (lines 16-48) and `launch/opengraph-image.tsx` (lines 34-82) re-inline the very same gradient and a near-identical `↑`-tile-plus-`ASCENT` lockup with slightly different magic numbers (48px vs 44px tile, `letterSpacing` 10 vs 9 vs 8). The brand palette literals (`#3b9eff`, `#04070e`, `#94a3b8`, `#0b1322`, `#080d1a`) are hand-repeated in every file.
- **Root cause**: Each OG route was authored independently as a self-contained `next/og` `ImageResponse` (SHELL-1/2 / MAP-5), copy-pasting the chrome rather than sharing it. There is no `src/lib/og` helper (confirmed: none exists).
- **Impact**: Four copies of the brand lockup already drift (tile size and letter-spacing differ between cards), so a brand tweak now means editing 4 files and the cards will keep diverging — the classic "two copies already drifting" duplication. The palette literals also bypass the design tokens that `globals.css` defines for the rest of the app.
- **Fix sketch**: Add a shared `src/lib/og/shell.tsx` exporting `OG_SIZE`/`OG_CONTENT_TYPE`, the `SHELL` style object, the brand color literals, and a `<Brand size?>` element factory. Have all four OG routes import them; delete the two identical local `SHELL`/`Brand` definitions and replace the two inlined lockups (root, launch) with the shared `Brand`. Behavior-preserving as long as the shared `Brand` is parameterized to reproduce each card's current tile size/letter-spacing (or those values are unified deliberately). `next/og` components are plain JSX, so a shared element factory bundles fine.

## 2. Neutral "fallback" OG card duplicated between the org and report routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/opengraph-image.tsx:127-147 · src/app/report/[owner]/[repo]/opengraph-image.tsx:140-160
- **Scenario**: The no-data fallback `ImageResponse` — `<Brand/>`, an uppercase monospace eyebrow ("Fleet maturity" / "Maturity report"), a 72px white slug headline, a `#94a3b8` "…5-level ladder across 9 dimensions, with evidence." tagline, and the identical `#64748b` monospace footer `ascent · scan → score → route to the next level` — is structurally the same block in both files, differing only by the eyebrow string and the slug/ref variable. (The footer line `scan → score → route to the next level` is grep-confirmed in exactly these two files.)
- **Root cause**: Same copy-paste origin as finding #1; the degraded-card path was duplicated alongside the data card.
- **Impact**: Two copies of the same fallback layout to keep in sync; a wording or layout change to the "neutral card" must be made twice or they drift. Lower severity than #1 because the blocks are not yet visibly diverging.
- **Fix sketch**: Once the shared OG module from #1 exists, add a `<FallbackOgCard eyebrow title tagline />` (or a small helper returning the `ImageResponse`) there and call it from both routes' fallback branches, passing the per-route eyebrow + slug/ref. Delete both inline fallback JSX blocks.

## 3. OG route metadata triplet (`alt` / `size` / `contentType`) hand-repeated in all four routes
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/opengraph-image.tsx:8-10 · src/app/launch/opengraph-image.tsx:11-13 · src/app/org/[slug]/opengraph-image.tsx:14-16 · src/app/report/[owner]/[repo]/opengraph-image.tsx:14-16
- **Scenario**: Every OG route re-declares `export const size = { width: 1200, height: 630 }` and `export const contentType = "image/png"` verbatim, plus a per-route `alt`. The width/height/content-type are identical across all four.
- **Root cause**: Next.js requires these as named exports from each route file, so they were copied per route.
- **Impact**: Minor — four identical `size`/`contentType` literals. The dimension is also the implicit contract the `SHELL`/`STARS` math assumes, so a change must touch every file. Low value on its own; worth folding into the #1 refactor.
- **Fix sketch**: In the shared `src/lib/og` module add `export const OG_SIZE = { width: 1200, height: 630 } as const;` and `export const OG_CONTENT_TYPE = "image/png";`, then in each route write `export const size = OG_SIZE; export const contentType = OG_CONTENT_TYPE;` (re-exporting a shared const still satisfies Next's named-export requirement). Leave each route's distinct `alt` string in place.
