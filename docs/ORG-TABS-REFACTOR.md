# Org dashboard refactor — one route, `?tab=`, staggered loading, 200-LOC files

> Target: `/org/[slug]/*` — 22 sub-routes, 203 `.tsx` under `src/components/org/`.
> Reference implementation: `C:\Users\kazda\kiro\kp` (`docs/LOADING_CHOREOGRAPHY.md`,
> `docs/FEATURE_STRUCTURE_REFACTOR.md`). Read both before starting a module.

## Why

1. **Page-per-module breaks the UX.** Twenty-two routes means twenty-two full navigations, each
   re-entering the shell and re-running its guards before any content can paint.
2. **Loading is inconsistent** because every page does a different amount of blocking work before
   first byte, and the segment's single `loading.tsx` paints an `animate-pulse` silhouette that
   matches no tab in particular — a fake page, then the real one.
3. **Files are too large and the tree does not mirror the UI.** `src/components/org/` is flat by
   feature name with no relation to the six nav groups a user actually sees.

---

## The one deliberate deviation from `kp`

**`kp` is client-first: `Workspace.tsx` is `"use client"`, every tab fetches from an API route.
Ascent stays server-first.**

Ascent's org tabs are server components that read the database directly, behind a tenant gate
(`canReadOrg`) enforced in the layout before any data is touched. Copying `kp` literally would mean
building ~20 new API routes, moving the tenant check into each one, and turning every tab into a
client waterfall (HTML → JS → fetch → paint). That is a performance and security regression sold as
a refactor.

**So we take from `kp`: the URL model, the loading choreography, the file/naming discipline, and the
ban on skeletons. We do not take: client-side data fetching.**

Concretely — the tab *shell* is a client component (instant highlight, no round trip to change the
selected pill); each tab *panel* stays a server component streamed into its own `<Suspense>`.

---

## 1. Routing & tab state

### `src/lib/org/orgTabs.ts` — the single source of truth (no JSX)

Derive the union type, the runtime guard and the nav grouping from ONE literal array. `kp`'s
`tabs.ts:10-41` names the bug this prevents: an id present in the guard but missing from the list
(or vice versa) makes a valid deep link silently 404 to the default.

```ts
export const ORG_TAB_IDS = ["overview","repositories","segments","tech-stacks", …] as const;
export type OrgTabId = (typeof ORG_TAB_IDS)[number];
export function isOrgTabId(v: string | null | undefined): v is OrgTabId
export const DEFAULT_ORG_TAB: OrgTabId = "overview";
export const ORG_NAV_GROUPS = [ /* overview · fleet · intelligence · plan · library · govern */ ]
export const PERSONAL_TAB_IDS: ReadonlySet<OrgTabId>   // personal workspaces show a subset
```

Ship `orgTabs.test.ts` pinning: every id in `ORG_NAV_GROUPS` is in `ORG_TAB_IDS` and vice versa
(minus any deliberate not-in-nav ids, listed explicitly); every `PERSONAL_TAB_IDS` member is a real
id; the default is a real id.

### URL building — never read `window.location`

Port `kp`'s `buildUrl(updates, search)` exactly, including its reasoning: `router.push`/`replace` do
not update `window.location` in the same tick, so two navigations close together would clobber each
other. Callers pass the React-tracked `useSearchParams().toString()` in.

- `?tab=overview` is **normalized away** — the default tab lives at `/org/[slug]`.
- `TAB_SCOPED_PARAM_KEYS` — params that must NOT survive a bare tab switch (`repo`, `seg`,
  `dim`, `q`, `edit`, `id`, …). `buildOrgTabUrl(id, search)` nulls them all. Params that are
  genuinely cross-tab (`range`/period, `techGroup`) survive **by design** — list them in a comment.
- Navigation is `router.push(..., { scroll: false })`, **not** `replace`: a tab switch is the
  navigation users most expect Back to undo. Within-tab view state uses `replace` (no history spam).

### Focus & announcement

Port `kp`'s pattern with the first-render guard, so a deep link never steals focus:

```tsx
const prev = useRef(active);
useEffect(() => { if (prev.current === active) return; prev.current = active;
  mainRef.current?.focus(); setAnnouncement(`${label} tab`); }, [active]);
```
Paired with `<main id="main" tabIndex={-1}>` (the skip-link target already exists) and an
`aria-live="polite" role="status"` sr-only node.

### Old routes → permanent redirects (NOT optional)

58 link sites across 38 files point at `/org/{slug}/{segment}`, **including the weekly digest email
and alert pushes** (`src/app/api/cron/digest/**`, `src/lib/alerts.ts`) — links already sitting in
inboxes that we cannot update. Every retired route keeps a `page.tsx` that is nothing but
`redirect(\`/org/${slug}?tab=${id}\`)`. Internal call sites move to a single `orgTabHref(slug, id)`
helper so the next rename is one edit.

---

## 2. Loading choreography

**Skeletons are banned.** Delete `src/app/org/[slug]/loading.tsx`'s `animate-pulse` block. A
placeholder that draws a shape the real content does not have is a lie told during the one moment
the user is paying attention.

### The invisible gap

Port `kp`'s `.reveal-quiet` (`globals.css`) and `QUIET_PLACEHOLDER_DELAY_MS = 150`:

```css
/* Invisible for its first 150ms, then fades up. `both` fills backwards through the delay, so
   anything that resolves inside the window paints not a single pixel of it. Placeholders ONLY —
   never real content, which must never be held back. */
.reveal-quiet { animation: arrive-in 200ms ease-out both; animation-delay: 150ms; }
```

A tab gap is an **empty** reserved-height box: `<div className="reveal-quiet min-h-[24rem]" aria-hidden />`.
Reserve height so the page below does not jump. Where a panel has a distinctive geometry (a
right-side drawer, a wide table), the gap may mimic that geometry — but it never draws content.

### Three tiers inside a tab

| Tier | What | When | Mechanism |
|---|---|---|---|
| 1 | Chrome, headings, anything needing no data | first frame | `stagger-children` on the section wrapper |
| 2 | Server-rendered data regions | as each `<Suspense>` resolves | own Suspense + `reveal-quiet` gap |
| 3 | Heavy / below-the-fold / independently-fetching client panels | a beat later, or on scroll | `<Defer>` + `next/dynamic` |

**Rules carried over from `kp`:** content is never held back waiting for a sibling; a refresh must
never hide data already on screen; do not put `.animate-arrive-in` on a direct child of
`stagger-children` (the cascade already animates it); never add `prefers-reduced-motion` at a call
site — it lives in the CSS and inside `Defer`.

### `src/components/ui/Defer.tsx` + `deferPolicy.ts`

Port both, keeping the policy pure and separate so timing constants are unit-testable and a panel can
import them without pulling a client component into its chunk.

```tsx
<Defer strategy="next-frame">   // requestAnimationFrame
<Defer strategy="idle">         // requestIdleCallback, 500ms timeout, setTimeout(0) fallback
<Defer strategy="visible">      // IntersectionObserver, rootMargin 240px
```

It is **not** a loading state — no spinner, no skeleton, no data. The children are ready; we are only
choosing *when* to commit them. It **fails open**: no IntersectionObserver, or no node → render
immediately. Content that never mounts is a far worse bug than content that mounts early.
Reduced motion collapses `next-frame`/`idle` to immediate but **not** `visible`, which is a payload
decision rather than a choreography one.

### Where Suspense goes

Per **data source**, not per tab. A tab whose four panels each own a query gets four boundaries, so a
slow one cannot hold the other three. This is the direct fix for "loading is inconsistent": the shell
and every cheap panel paint immediately, and only the genuinely slow region waits.

---

## 3. Files, folders, naming

### The cap: **200 lines, `.tsx` only**

`.ts` is deliberately uncapped. The rule pushes complexity *out of JSX files* — it does not cap
complexity. `kp`'s `usePipelineTabState.ts` is 962 lines by design. Extraction order, in priority:

1. state/effects/handlers → `use<Feature><Thing>.ts` (owns no JSX)
2. pure functions → `<feature><Thing>.ts`
3. types → `<Feature>Types.ts`
4. JSX regions → sibling `<Feature><Thing>Panel.tsx`
5. `dynamic()` registry → `<Feature>TabChunks.tsx`

### The tree mirrors the nav

```
src/components/org/
  shell/          OrgWorkspace.tsx  OrgTabChunks.tsx  OrgTabNav.tsx  orgTabs.ts
  overview/       OverviewTab.tsx + parts
  fleet/          repositories/ segments/ tech-stacks/ teams/ contributors/ adoption/ delivery/
  intelligence/   executive/ live/ security/ passports/
  plan/           plan/ backlog/ practices/
  library/        skills/ memory/
  govern/         governance/ members/ audit/ integrations/ settings/
  shared/         ← cross-group only; nothing here may import from a group
```

### Naming by role (from `kp`, verified against its real filenames)

| Role | Convention | Example |
|---|---|---|
| Tab entry (orchestrator) | `<Feature>Tab.tsx` — **filename pinned**, the shell imports it by path | `SecurityTab.tsx` |
| Chunk registry | `<Feature>TabChunks.tsx` | `DeliveryTabChunks.tsx` |
| Panel / section | `<Feature><Thing>Panel.tsx` | `SecurityAdvisoriesPanel.tsx` |
| Part (row/cell) | same prefix, deeper noun | `SecurityAdvisoryRow.tsx` |
| Hook | `use<Feature><Thing>.ts` | `useDeliveryTrend.ts` |
| Pure logic | `<feature><Thing>.ts` | `securityPostureRank.ts` |
| Types | `<Feature>Types.ts` | `DeliveryTypes.ts` |
| Test | co-located `<same-name>.test.ts(x)` | `securityPostureRank.test.ts` |

There is no dotted `.panel.tsx` / `.logic.ts` convention — role is expressed by PascalCase noun
suffix for components and camelCase filename for non-JSX modules.

**When a pinned entry file must shed exports**, keep barrel re-exports in it so call sites are
unchanged (`kp`'s `AnalyticsTab.tsx:23-30`).

---

## 4. Gotchas — read before you start

1. **Every tab unmounts on switch.** No state survives. Deep-link params must hydrate via lazy
   initializers off render-time params, not effects.
2. **`replace` on a tab switch breaks Back** — it made `kp`'s workspace exit entirely. Use `push`.
3. **Never `history.pushState`** — it does not re-trigger `useSearchParams` in Next 16; the nav
   silently stops switching content.
4. **The layout's guards stay in the layout.** Do not duplicate `canReadOrg` into tabs.
5. **`force-dynamic` is on the layout.** Keep it; the tenant gate must never be cached.
6. **Do not "simplify" the panel switch into a `Record<TabId, Component>`** without handling tabs
   that need a prop derived from the raw (pre-normalization) tab id.
7. **The period/window cookie is cross-tab state.** `resolveOrgWindow` reads `?range=` then a cookie;
   `range` must survive a tab switch, so it is NOT in `TAB_SCOPED_PARAM_KEYS`.
8. Some tests assert on source text. Splitting a file breaks them by design — a stale one failing
   loudly is the point.

---

## 5. Sequencing

**Foundation lands first, alone.** Every module depends on the shell, `orgTabs.ts`, `Defer` and
`.reveal-quiet`; twenty agents cannot build against a shell that does not exist. The foundation ships
with the old routes still working (redirects added, tabs registered one by one), so the tree is green
at every step.

Then one agent per nav group, in parallel — each owns a disjoint folder and a disjoint set of tabs.
