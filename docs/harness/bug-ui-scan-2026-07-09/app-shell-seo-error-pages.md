# App Shell, SEO & Error Pages — bug-hunter + ui-perfectionist scan

> Context: App Shell, SEO & Error Pages (group: Onboarding, Shell & AI Standard)
> Files scanned: 15
> Total: 7 findings (Critical: 0, High: 0, Medium: 3, Low: 4)

Notes on things checked and cleared: `sitemap.ts`/`robots.ts` do NOT touch the DB and never enumerate org slugs (static routes only; the two contracts are kept disjoint) — no private-slug leak. All 7 sitemap-advertised routes resolve to real pages. `manifest.ts` declaring `logo-mark.png` as `image/jpeg` is correct — the file is genuinely JPEG despite the `.png` name (verified magic bytes). `org/[slug]/opengraph-image.tsx` gates real numbers behind `canReadOrg` (which lower-cases + resolves membership), and `postureCounts` is always populated, so no private-data leak and no undefined-index crash. `/api/health` correctly withholds the raw DB error string. `global-error.tsx` self-containment is appropriate.

## 1. Global skip-to-content link is a dead anchor on several public pages
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/app/layout.tsx:78
- **Scenario**: A keyboard user tabs to the always-present "Skip to content" link (href `#main`) on `/trends`, `/usage`, `/badge`, `/launch`, `/connect`, or `/onboarding` and presses Enter. Focus goes nowhere — those `page.tsx` files render no element with `id="main"`.
- **Root cause**: The skip link lives in the root layout and assumes every route renders an `#main` landmark, but that contract is unenforced — only ~10 of the routable pages actually declare it (`grep 'id="main"'`).
- **Impact**: The primary a11y affordance silently no-ops on ~6 public pages; screen-reader/keyboard users can't bypass the header. WCAG 2.4.1 bypass-blocks failure.
- **Fix sketch**: Give the shared page/`<main>` wrapper (or a layout-level `<main id="main">`) the id so every route inherits it, rather than hand-adding `id="main"` per page. Add a lint/test asserting each `page.tsx` renders exactly one `#main`.

## 2. Org OG image re-runs the heavy `getOrgRollup` aggregate on every unauthenticated request, uncached
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance-cost
- **File**: src/app/org/[slug]/opengraph-image.tsx:14
- **Scenario**: Any client (a social crawler refetching an unfurl, or an adversary in a loop) hits `GET /org/<public-slug>/opengraph-image`. Each request runs `runtime = "nodejs"` + `getOrgRollup(slug)` — described in `org-rollup.ts` as "all repos + latest scans + per-dim rows + governance/passport parsing." There is no `revalidate`/`dynamic`/cache export, so it is dynamic per request.
- **Root cause**: Assumption that an OG route is hit rarely and cheaply; here it is a public, auth-free endpoint doing a multi-table Prisma aggregate with no cache TTL.
- **Impact**: DB CPU/cost amplification (DSQL is billed) driven by anonymous traffic; unfurl storms on a viral leaderboard org repeatedly recompute the same card.
- **Fix sketch**: Add `export const revalidate = 3600` (or a short TTL) so Next caches the generated PNG per slug; the fleet card tolerates staleness. Optionally memoize the rollup behind a cache.

## 3. `RouteError`/`global-error` "Try again" (reset only) does not recover server-originated errors
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/components/ui/RouteError.tsx:45
- **Scenario**: A server component throws (e.g. a nested org layout hits a transient DSQL blip). The user lands on the boundary and clicks the primary "Try again" button, which calls `reset()` only (same call in `error.tsx`, org `error.tsx`, and `global-error.tsx:73`). For a server-thrown error whose inputs are unchanged, `reset()` re-renders in place and frequently re-throws immediately — a flicker with zero feedback, no indication the retry failed.
- **Root cause**: `reset()` alone re-renders the boundary's subtree but doesn't force a fresh server render; the documented robust pattern pairs it with `router.refresh()`.
- **Impact**: The primary recovery CTA is misleading for the most common error source (a server throw); users perceive a stuck/looping page. The copy even promises "retrying often resolves it."
- **Fix sketch**: In the retry handler call `router.refresh()` then `reset()` (client component already), so the RSC payload is re-fetched before re-rendering. For `global-error`, keep the hard `<a href="/">` as the reliable fallback.

## 4. `/api/health` discloses deployment topology to anonymous callers
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: info-disclosure
- **File**: src/app/api/health/route.ts:25
- **Scenario**: Any unauthenticated caller `GET /api/health` and reads `{ dbMode, autoscan: { cronSecret, githubApp, db } }` (lines 25, 33, 48). This reveals the active persistence backend (`"dsql"`/`"postgres"`/`"pglite"`) and exactly which secrets/integrations are present (whether `CRON_SECRET` is set, whether the GitHub App is configured).
- **Root cause**: The endpoint carefully redacts the raw DB *error* but still returns internal *configuration state* on an intentionally public, unauthenticated route.
- **Impact**: Recon aid — an attacker learns the infra backend and which config gaps exist (e.g. cron secret unset) to target. Minor but unnecessary on an anon endpoint.
- **Fix sketch**: Return only `{ status, db: up|down|disabled }` to anonymous callers; gate `dbMode`/`autoscan` details behind a header/secret (or emit them only server-side / to an authenticated monitor).

## 5. Error/404/EmptyState pages hardcode `slate-700/800` instead of the `divider`/`surface` tokens created to kill that drift
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: design-token-drift
- **File**: src/components/EmptyState.tsx:45
- **Scenario**: `globals.css:20-26` defines `--color-divider` (slate-800) and `--color-surface` explicitly to "replace the slate-800/slate-700 drift" for borders/panels. Yet `EmptyState.tsx:45` (`border-slate-800`), `:46/:72` (`border-slate-700`), `not-found.tsx:66/74` (`border-slate-700`), and `RouteError.tsx:52` (`border-slate-700`) all still use raw slate literals.
- **Root cause**: New shell/notice components didn't adopt the token that was introduced for exactly these borders, so a future accent/divider retune won't reach them.
- **Impact**: These borders won't track a token change; visual drift between tokenized and hardcoded surfaces. Low, cosmetic/maintainability.
- **Fix sketch**: Swap `border-slate-800`→`border-divider` and `border-slate-700`→`border-divider` (or `border-divider/70` to match the header), and `bg-slate-900/20`→`bg-surface/40`.

## 6. Primary/secondary buttons are hand-rolled with drifting radius + padding across the shell states (no shared Button)
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: component-extraction
- **File**: src/components/EmptyState.tsx:71
- **Scenario**: The same conceptual accent/outline button is re-authored per file with different pixels: `EmptyState.tsx:71-72` uses `rounded-xl px-5 py-2.5`, while `not-found.tsx:57-59/66-68` and `RouteError.tsx:46/52` use `rounded-md px-4 py-2`, and `global-error.tsx:74-100` uses inline `borderRadius: 8`. There is no shared `Button` primitive (only `auth/buttonChrome.tsx` for auth).
- **Root cause**: No canonical button component, so each shell surface re-derives the accent/outline recipe and they've drifted on corner radius and padding.
- **Impact**: Inconsistent button shape/size between the 404, error, and empty states that a user may see back-to-back. Low.
- **Fix sketch**: Extract a `<Button variant="primary"|"outline">` (accepting `href`|`onClick`) that owns the `rounded-md bg-accent … text-on-accent` recipe, and route these four sites through it. `global-error` stays inline (self-contained) but should match the radius.

## 7. `EmptyState` renders arbitrary `body` ReactNode inside a `<p>` — block content is invalid nesting
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: html-nesting
- **File**: src/components/EmptyState.tsx:61
- **Scenario**: `body` is typed `ReactNode` (line 34) but always rendered as `<p className={bodyCls}>{body}</p>` (line 61). Callers pass arbitrary nodes through it — `usageShell.tsx:17` (`body={children}`) and `org/ui.tsx:257` (`body={children}`) forward whatever their parents supply. If any such child is a block element (`<div>`, `<ul>`, another `<p>`), the browser auto-closes the `<p>`, producing a DOM that differs from the server render → React hydration mismatch and dropped styling.
- **Root cause**: The API advertises `body: ReactNode` (rich content welcome) but the implementation only supports phrasing content.
- **Impact**: Latent hydration warning / broken layout the day a caller passes a list or multi-paragraph body through the `children` pass-throughs. Currently most callers pass strings, so it's latent.
- **Fix sketch**: Render `body` in a `<div className={bodyCls}>` instead of `<p>`, or narrow the prop to `string` and add a separate `richBody` slot. A `<div>` is safe for both text and block content.
