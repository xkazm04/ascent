// The org dashboard's tab universe — the single source of truth for ids, labels, nav grouping and
// URL building. No JSX, no client hooks: imported by the client shell (OrgTabNav), the server page
// (/org/[slug]/page.tsx), the legacy route redirects, and by any tab that needs to link to a sibling.
//
// See docs/ORG-TABS-REFACTOR.md. Reference implementation: `kp`'s app/features/shell/tabs.ts.

/**
 * Single source of truth for the tab universe. The `OrgTabId` union AND the runtime allowlist behind
 * `isOrgTabId` are both derived from this one literal array, so the type and the guard can never
 * drift — adding a tab is a one-line edit the compiler keeps consistent. An id present in the guard
 * but missing from the list (or vice versa) used to be a silent bug: a deep link to a valid tab
 * resolved to the default with no error.
 */
export const ORG_TAB_IDS = [
  // Overview
  "overview",
  // The follow-ups ledger: every open gap across the fleet, pick a batch, hand it to a local agent.
  "followups",
  "executive",
  // Fleet
  "repositories",
  // Segments is a SUB-VIEW of the Repositories tab (the two Fleet views were merged), reached from
  // inside it rather than from the rail — a valid id, intentionally absent from ORG_NAV_GROUPS
  // below. It is also why the Repositories tab must read the RAW tab id, not the normalized one
  // (gotcha #6 in the design doc): `?tab=segments` renders Repositories in segments mode.
  "segments",
  "tech-stacks",
  "passports",
  "live",
  // Intelligence
  "security",
  "adoption",
  "delivery",
  "contributors",
  "teams",
  // Plan (the Plan and Backlog tabs were retired 2026-08-17 in favour of the Follow-ups ledger)
  "practices",
  // Library
  // The customer-owned registry repo (Skills/Practices/Memory as git) — first item in `Shared`,
  // because the other three Library tabs read their source of truth from it once it is mapped.
  "registry",
  "skills",
  "memory",
  // UC3 "individual care". A first-class id (label / a11y / href contract), but NEITHER a `?tab=`
  // panel NOR a rail item: it is the personalized route `/org/developer`, which every signed-in
  // developer sees their OWN slice of, so it can't be an org-scoped panel — and its one entry point is
  // now the header identity menu (src/components/header/IdentityMenu.tsx), not the org rail. See
  // `orgTabHref`, `ORG_TABS_NOT_IN_NAV` and docs/REGISTRY-AND-CARE-IMPL.md §5.1. (The former `care`
  // id, whose org mode is now a section inside Contributors, is retired.)
  "developer",
  // Govern
  "members",
  "governance",
  "integrations",
  "audit",
  "settings",
] as const;

export type OrgTabId = (typeof ORG_TAB_IDS)[number];

// Built from the canonical array above — never re-listed — so it stays in lockstep with the union.
const TAB_IDS: ReadonlySet<OrgTabId> = new Set(ORG_TAB_IDS);

export function isOrgTabId(value: string | null | undefined): value is OrgTabId {
  return typeof value === "string" && TAB_IDS.has(value as OrgTabId);
}

/**
 * The tab a workspace with no history opens on: read your baseline first.
 *
 * W1b (2026-08-14) — this is now a FALLBACK, not "the tab at the bare URL". A returning org whose
 * loop is running lands on `live` instead (see `resolveLandingTab` in src/lib/org/landing.ts), so
 * `/org/<slug>` means "take me to this org", not "the Overview tab". Overview has its own explicit
 * `?tab=overview` URL — see the note on `buildUrl`.
 */
export const DEFAULT_ORG_TAB: OrgTabId = "overview";

/** Key into `NavCounts` (src/lib/org/nav-counts.ts). Kept as a string here so this JSX-free module
 *  stays free of a nav-counts import; OrgTabNav pins it against the real `NavCounts` type. */
export type OrgTabCountKey = "passports" | "security" | "contributors" | "teams" | "followups" | "members";

export interface OrgTabDef {
  id: OrgTabId;
  label: string;
  /** Key into the shell's `counts`. Omitted for pages with no resolvable work awaiting a decision. */
  countKey?: OrgTabCountKey;
}

export interface OrgNavGroup {
  /** Stable section id — the rail button identity and the icon lookup key. */
  key: string;
  /** Full name: the panel eyebrow, the mobile chip, the rail tooltip. */
  label: string;
  /** Abbreviated name for the narrow desktop rail. Falls back to `label`. */
  short?: string;
  items: readonly OrgTabDef[];
}

/**
 * The five module groups the rail renders. The icons stayed behind in the client nav (they are JSX,
 * keyed by `group.key`).
 *
 * W1a (2026-08-14) REGROUPED these from the original six data-type modules (Overview · Fleet ·
 * Intelligence · Plan · Library · Govern) to the four questions a transformation owner is asked in a
 * leadership meeting, plus an admin tail:
 *
 *   Standing  — where are we, honestly?
 *   Shared    — what do we publish once and every repo consumes?
 *   In flight — what is moving right now?
 *   Bought    — what did the last period buy us?
 *   Admin     — the boring rows, deliberately not hidden.
 *
 * The rationale is in docs/AI-SDLC-COMPANION-PLAN.md §Wave 1. A nav grouped by DATA TYPE reads as a
 * filing cabinet and answers no question anyone is actually asked; grouped by the journey it reads as
 * a story with a next move. NOTHING about the tab universe changed: `ORG_TAB_IDS`, `PERSONAL_TAB_IDS`,
 * `MIGRATED_ORG_TAB_IDS`, every id, every href and every legacy redirect are untouched — this is a
 * regrouping and a relabelling of the module layer only.
 *
 * "In flight" is deliberately the SMALLEST group and the one a returning org lands in (see
 * `shouldLandOnLoop`): the loop is the product, and it used to sit third of four inside "Fleet".
 *
 * A flat tab list, if ever needed, should be derived from `ORG_NAV_GROUPS.flatMap(g => g.items)`
 * rather than maintained as a second parallel declaration.
 */
export const ORG_NAV_GROUPS: readonly OrgNavGroup[] = [
  {
    key: "standing",
    label: "Standing",
    items: [
      { id: "overview", label: "Overview" },
      // The action surface of Standing: what the scans left open, as a ledger you can hand off from.
      // Sits right under Overview because the ledger's rows ARE the Overview's "owe a follow-up".
      { id: "followups", label: "Follow-ups", countKey: "followups" },
      // Segments is merged into Repositories as its "?tab=segments" view — no separate rail item.
      { id: "repositories", label: "Repositories" },
      { id: "tech-stacks", label: "Tech Stacks" },
      { id: "passports", label: "Passports", countKey: "passports" },
      { id: "security", label: "Security", countKey: "security" },
      { id: "adoption", label: "Adoption" },
      // Governance is a READING of where the fleet stands on branch protection, review gates and
      // rulesets — an audit of the current state, not something the org distributes. It sits last in
      // Standing (moved here from the old `chosen` group) because it answers "where are we, honestly?"
      // about the controls, which is the same question every tab above it answers about the code.
      { id: "governance", label: "Governance" },
    ],
  },
  {
    // `shared`, not `chosen`: this group holds the org's SHARED primitives — the registry repo and
    // everything it distributes to the fleet (practices, skills, memory). The old name described the
    // act of choosing; the group is really about what the org publishes ONCE and every repo consumes.
    key: "shared",
    label: "Shared",
    items: [
      // Registry sits FIRST: it is the onboarding step Practices/Skills/Memory depend on, and their
      // sync-health strip links back here (docs/REGISTRY-AND-CARE-IMPL.md §0.2).
      { id: "registry", label: "Registry" },
      { id: "practices", label: "Practices" },
      { id: "skills", label: "Skills" },
      { id: "memory", label: "Memory" },
    ],
  },
  {
    key: "inflight",
    label: "In flight",
    items: [
      { id: "live", label: "Live" },
    ],
  },
  {
    key: "bought",
    label: "Bought",
    items: [
      { id: "executive", label: "Briefing" },
      { id: "delivery", label: "Delivery" },
      { id: "contributors", label: "Contributors", countKey: "contributors" },
      { id: "teams", label: "Teams", countKey: "teams" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { id: "members", label: "Members", countKey: "members" },
      { id: "integrations", label: "Integrations" },
      { id: "audit", label: "Audit" },
      { id: "settings", label: "Settings" },
    ],
  },
];

/**
 * Ids that are deliberately NOT rail items — reachable only from inside another tab. Listed
 * explicitly so the `ORG_NAV_GROUPS` ⟷ `ORG_TAB_IDS` completeness test can tell "intentionally
 * absent" from "forgot to add it to the nav".
 */
export const ORG_TABS_NOT_IN_NAV: ReadonlySet<OrgTabId> = new Set<OrgTabId>([
  "segments",
  // `developer` left the rail: the personalized route is reached from the HEADER identity menu (your
  // own name, on every page, signed in or not in an org), which is the one place a personal surface
  // belongs — it is not an org-scoped view and never was. Still a full id: label, href contract and
  // the `/org/<slug>/developer` redirect stub all remain.
  "developer",
]);

/**
 * The tabs a PERSONAL workspace (Organization.kind === "personal") shows. An individual's public-repo
 * workspace keeps the per-repo evaluation surfaces; fleet aggregation/attribution surfaces (teams,
 * segments, adoption, delivery, live, members, integrations…) need a real org's breadth and stay
 * org-only. Moved verbatim from OrgNav's PERSONAL_SEGMENTS (where "" meant the overview root).
 */
export const PERSONAL_TAB_IDS: ReadonlySet<OrgTabId> = new Set<OrgTabId>([
  "overview",
  "security",
  "followups",
  "registry",
  "skills",
  "memory",
  // The developer's own home — in a personal workspace this surface is the point of the product. It
  // is in the personal SET (so `PERSONAL_TAB_IDS.has("developer")` stays true for any gate that asks)
  // but no longer renders as a rail item: it is not in ORG_NAV_GROUPS, and the header identity menu
  // is its entry point.
  "developer",
]);

/** Every tab's label, derived from the nav catalog (plus the not-in-nav ids). For the a11y
 *  announcement and any breadcrumb — never re-declare a label at a call site. */
const LABELS: ReadonlyMap<OrgTabId, string> = new Map<OrgTabId, string>([
  ...ORG_NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label] as [OrgTabId, string])),
  ["segments", "Segments"],
  ["developer", "Developer"],
]);

export function orgTabLabel(id: OrgTabId): string {
  return LABELS.get(id) ?? id;
}

// ---------------------------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------------------------

/**
 * The deep-link query params that scope a tab's view to a specific selection, filter or prefill.
 * These must NOT survive a bare tab switch: otherwise the destination tab inherits the previous
 * tab's selection (Audit's `?actorId=` silently narrowing Members, the billing return `?credits=`
 * replaying on every tab). This is the single canonical declaration — `buildOrgTabUrl` clears every
 * key here and the unit test pins the exact set, so adding a deep-link param is a deliberate,
 * reviewed edit rather than a silent leak.
 *
 * ANYTHING NOT LISTED HERE SURVIVES A TAB SWITCH BY DESIGN. The deliberate survivors:
 *   - `range` / `from` / `to` — the period window. `resolveOrgWindow` reads `?range=` then the
 *     period cookie; the selected period is explicitly cross-tab state (design doc gotcha #7), so
 *     putting `range` in this list would silently reset the user's window on every tab click.
 *   - `segment` / `stack` / `techGroup` — the fleet scope filters (`resolveOrgScope`). Carrying a
 *     scope across tabs is the whole point of them: pick a segment on Overview, see the same
 *     segment on Security.
 */
export const TAB_SCOPED_PARAM_KEYS = [
  // Selection / drill-in
  "repo",
  "dim",
  "seg",
  "id",
  "edit",
  // Comparison pickers (teams / contributors A-vs-B)
  "a",
  "b",
  // Search + list filters
  "q",
  "search",
  "posture",
  "kind",
  "category",
  "namespace",
  "includeClosed",
  // Audit-trail filters + keyset cursor
  "actorId",
  "action",
  "since",
  "until",
  "cursor",
  // One-shot post-checkout return flag (/api/billing/checkout → Overview). Consumed into a
  // dismissible notice; a tab switch must never replay it.
  "credits",
] as const;

export type TabScopedParamKey = (typeof TAB_SCOPED_PARAM_KEYS)[number];

/** A `{ key: null }` patch that clears every tab-scoped param. Spread into `buildUrl` rather than
 *  hand-listing keys at a call site — that literal is exactly what rots as params are added. */
export function clearedTabScopedParams(): Record<TabScopedParamKey, null> {
  return Object.fromEntries(TAB_SCOPED_PARAM_KEYS.map((k) => [k, null])) as Record<TabScopedParamKey, null>;
}

/**
 * Build an `/org/<slug>[?…]` href by patching `search` (the current query string, e.g. from
 * `useSearchParams().toString()`) with `updates` (null/"" clears a key).
 *
 * `search` MUST be the React-tracked searchParams string — callers pass it in rather than letting
 * this read `window.location`. `router.replace`/`push` (next/navigation) do NOT update
 * `window.location` in the same tick, so when two navigations fire close together — a user clicking
 * a deep link then a tab — a `window.location` read on the second call would see the
 * pre-first-navigation URL and clobber the first update (lost scope/period params). Composing off
 * the committed router state (`useSearchParams`) instead makes successive patches stack correctly.
 *
 * Components still pass the result to next/navigation's router so App Router's `useSearchParams`
 * reliably re-renders — a raw `history.pushState` does NOT trigger that in Next 16, which is why
 * sidebar clicks weren't switching content.
 *
 * DEVIATION from `kp`: its workspace is rooted at "/" so `buildUrl(updates, search)` needed no path
 * input. Ascent's shell is rooted at `/org/<slug>`, so `slug` is threaded in — kept FIRST across
 * this module (`buildUrl` / `buildOrgTabUrl` / `orgTabHref`) so every URL helper reads the same way.
 */
export function buildUrl(slug: string, updates: Record<string, string | null>, search: string): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  // W1b REMOVED the "normalize the default tab away" rule that used to live here. It rested on an
  // assumption that stopped being true: that the bare `/org/<slug>` IS the Overview tab. The bare URL
  // is now the org's LANDING decision (resolveLandingTab — a returning org whose loop is running opens
  // on Live), so collapsing `?tab=overview` into it would make Overview unreachable from the rail:
  // click Overview → bare URL → landing resolves to Live → Overview can never be opened.
  //
  // The two concepts are now distinct URLs, which is what they always were conceptually:
  //   /org/<slug>                → "take me to this org"  (landing decides the tab)
  //   /org/<slug>?tab=overview   → "the Overview tab"     (explicit, never redirected)
  const base = `/org/${encodeURIComponent(slug)}`;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Href for a bare tab switch (rail click, keyboard nav): select `tab` and clear every tab-scoped
 * param so the destination opens on a clean view. `search` is the React-tracked searchParams string
 * (see `buildUrl`) — threaded through so the switch composes off the committed router state, not a
 * stale `window.location` read.
 */
export function buildOrgTabUrl(slug: string, id: OrgTabId, search: string): string {
  return buildUrl(slug, { tab: id, ...clearedTabScopedParams() }, search);
}

/**
 * Which tab is showing, from the two places the answer can live during (and after) the migration:
 * the `?tab=` param on the shell route, and the path segment on a not-yet-migrated legacy route.
 * Pure so the rail's "you are here" and the server page agree without either re-deriving it.
 *
 * An unrecognized value in either position resolves to `fallback` rather than erroring — a stale
 * bookmark lands on the dashboard, never on a 404.
 *
 * `fallback` (W1b) is the org's resolved LANDING tab, threaded in by the shell so the rail lights the
 * panel the page actually rendered. It defaults to `DEFAULT_ORG_TAB` for every caller that has no org
 * context (and for a workspace with no loop running, that IS the landing tab). Passing it explicitly
 * is what stops the rail from highlighting Overview while the content slot shows Live.
 */
export function resolveActiveOrgTab(
  pathname: string | null | undefined,
  tabParam: string | null | undefined,
  fallback: OrgTabId = DEFAULT_ORG_TAB,
): OrgTabId {
  const parts = (pathname ?? "").split("/").filter(Boolean);
  // `/org/developer` is a STATIC route, not a slug — the personalized Developer home (§5.1). It is a
  // rail item with no `?tab=` and no `/org/<slug>/<tab>` shape, so it is resolved by name here (the
  // shell also passes `activeOverride`, which wins; this keeps the pure helper honest on its own).
  if (parts[0] === "org" && parts[1] === "developer" && parts.length === 2) return "developer";
  // /org/<slug>/<segment>[/...] — a drill-in under a tab keeps that tab lit.
  const segment = parts[0] === "org" ? parts[2] : undefined;
  if (segment) return isOrgTabId(segment) ? segment : fallback;
  return isOrgTabId(tabParam) ? tabParam : fallback;
}

// ---------------------------------------------------------------------------------------------
// Migration seam — DELETE THIS BLOCK once all 22 tabs live in the shell
// ---------------------------------------------------------------------------------------------

/**
 * The tabs that have actually been migrated into the `?tab=` shell. The shell lands first with the
 * old routes still working, so a tab is only reachable at `?tab=<id>` once its panel is registered
 * in OrgTabChunks — otherwise `?tab=security` would render an empty page.
 *
 * A module agent migrating a tab does three things: move the panel under the new folder, register it
 * in `OrgTabChunks`, and add its id HERE. When the set equals `ORG_TAB_IDS`, delete this constant,
 * `legacyOrgTabPath` and the fallback branch in `orgTabHref` — `orgTabHref` then collapses to
 * `buildUrl(slug, { tab: id }, "")`.
 */
export const MIGRATED_ORG_TAB_IDS: ReadonlySet<OrgTabId> = new Set<OrgTabId>([
  "overview",
  "audit",
  "executive",
  "live",
  "security",
  "passports",
  "governance",
  "members",
  "integrations",
  "settings",
  "skills",
  "memory",
  "repositories",
  "segments",
  "tech-stacks",
  "teams",
  "contributors",
  "adoption",
  "delivery",
  "practices",
  "followups",
  "registry",
]);

export function isMigratedOrgTab(id: OrgTabId): boolean {
  return MIGRATED_ORG_TAB_IDS.has(id);
}

/** The pre-refactor route for a tab. Still the real page for un-migrated tabs; for migrated ones it
 *  is a `redirect()` stub kept forever, because 58 link sites — including the weekly digest email
 *  and alert pushes already sitting in inboxes — point at these paths. */
export function legacyOrgTabPath(slug: string, id: OrgTabId): string {
  const base = `/org/${encodeURIComponent(slug)}`;
  // `developer` is not a legacy route and never becomes a `?tab=` panel: it is the personalized
  // route, org context carried as a query param. Handled here as well as in `orgTabHref` so no caller
  // can build `/org/<slug>/developer` (which is only a redirect stub) by reaching for the low-level
  // helper. See docs/REGISTRY-AND-CARE-IMPL.md §5.1.
  if (id === "developer") return `/org/developer?org=${encodeURIComponent(slug)}`;
  return id === DEFAULT_ORG_TAB ? base : `${base}/${id}`;
}

/**
 * THE helper every internal link to an org tab uses. One edit site for the next rename.
 *
 * Returns the canonical `?tab=` href for a migrated tab and the legacy route for one that has not
 * moved yet, so the tree stays green at every step of the migration and no call site needs to know
 * which world a tab is in.
 */
export function orgTabHref(slug: string, id: OrgTabId): string {
  return isMigratedOrgTab(id) ? buildUrl(slug, { tab: id }, "") : legacyOrgTabPath(slug, id);
}
