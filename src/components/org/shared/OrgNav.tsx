"use client";

import { usePathname } from "next/navigation";
import { SectionRailNav, type RailSection } from "@/components/ui";
// Type-only (erased at build): keeps `countKey` honest against the shell's actual count keys.
import type { NavCounts } from "@/lib/org/nav-counts";
import { FleetIcon, GovernIcon, IntelligenceIcon, LibraryIcon, OverviewIcon, PlanIcon } from "../overview/orgIcons";

/**
 * Persistent section nav across the org sub-pages, rendered as a two-level rail (SectionRailNav): an
 * icon rail of module groups (Overview · Fleet · Intelligence · Plan · Library · Govern) beside a panel
 * holding only the selected group's pages. Twenty views no longer stack into one column — the panel
 * follows the route, and clicking a group previews its pages without navigating (the groups are
 * organizing labels, not routes of their own). On small screens both levels degrade to scrollers.
 *
 * A module carries a badge when it has items awaiting a decision. `counts` is keyed by route segment
 * and supplied by the shell (getNavCounts); a section's rail badge is the sum of its pages', so a
 * collapsed group still tells you there's work inside it. A badge only appears where acting on the
 * items actually decrements it — either a persisted status column (backlog · plan · members) or a
 * derived finding a human can decide on (security · teams · passports · contributors). See
 * src/lib/org/nav-counts.ts.
 */

type Tab = {
  href: string;
  label: string;
  /** Key into `counts`. Omitted for pages with no resolvable work. */
  countKey?: keyof NavCounts;
};

type Def = Omit<RailSection, "items" | "count"> & { tabs: Tab[] };

/**
 * A page's own sub-routes keep its rail item lit, so a drill-in never blanks the nav. The org root is
 * matched exactly — as a prefix it would own every sibling. Query strings never reach `usePathname`,
 * so the repositories page keeps its item lit across its `?tab=segments` view.
 */
function isActive(path: string, href: string, base: string): boolean {
  if (href === base) return path === base;
  return path === href || path.startsWith(`${href}/`);
}

/**
 * The pages a PERSONAL workspace (Organization.kind === "personal") shows, as route segments under the
 * org base ("" = the overview root, which IS the watchlist — /repositories redirects there). An
 * individual's public-repo workspace keeps the per-repo evaluation surfaces; fleet
 * aggregation/attribution surfaces (teams, segments, adoption, delivery, live, members,
 * integrations…) need a real org's breadth and stay org-only.
 */
const PERSONAL_SEGMENTS = new Set(["", "security", "backlog", "skills", "memory"]);

export function OrgNav({ slug, counts, kind = "org" }: { slug: string; counts?: NavCounts; kind?: "org" | "personal" }) {
  const path = usePathname();
  const base = `/org/${slug}`;
  const def: Def[] = [
    {
      key: "overview",
      label: "Overview",
      icon: <OverviewIcon size={24} />,
      tabs: [
        { href: base, label: "Overview" },
        { href: `${base}/executive`, label: "Briefing" },
      ],
    },
    {
      key: "fleet",
      label: "Fleet",
      icon: <FleetIcon size={24} />,
      tabs: [
        // Segments merged into the Repositories page as its "?tab=segments" tab — no separate rail item.
        { href: `${base}/repositories`, label: "Repositories" },
        { href: `${base}/tech-stacks`, label: "Tech Stacks" },
        { href: `${base}/passports`, label: "Passports", countKey: "passports" },
        { href: `${base}/live`, label: "Live" },
      ],
    },
    {
      key: "intelligence",
      label: "Intelligence",
      short: "Intel",
      icon: <IntelligenceIcon size={24} />,
      tabs: [
        { href: `${base}/security`, label: "Security", countKey: "security" },
        { href: `${base}/adoption`, label: "Adoption" },
        { href: `${base}/delivery`, label: "Delivery" },
        { href: `${base}/contributors`, label: "Contributors", countKey: "contributors" },
        { href: `${base}/teams`, label: "Teams", countKey: "teams" },
      ],
    },
    {
      key: "plan",
      label: "Plan",
      icon: <PlanIcon size={24} />,
      tabs: [
        { href: `${base}/practices`, label: "Practices" },
        { href: `${base}/plan`, label: "Plan", countKey: "plan" },
        { href: `${base}/backlog`, label: "Backlog", countKey: "backlog" },
      ],
    },
    {
      key: "library",
      label: "Library",
      icon: <LibraryIcon size={24} />,
      tabs: [
        { href: `${base}/skills`, label: "Skills" },
        { href: `${base}/memory`, label: "Memory" },
      ],
    },
    {
      key: "govern",
      label: "Govern",
      icon: <GovernIcon size={24} />,
      tabs: [
        { href: `${base}/members`, label: "Members", countKey: "members" },
        { href: `${base}/governance`, label: "Governance" },
        { href: `${base}/integrations`, label: "Integrations" },
        { href: `${base}/audit`, label: "Audit" },
        { href: `${base}/settings`, label: "Settings" },
      ],
    },
  ];

  // Personal workspaces render the same rail from the same def, filtered to the individual subset —
  // one source of truth for hrefs/labels/badges, so an org-nav change can't drift from the personal one.
  const visible =
    kind === "personal"
      ? def
          .map((g) => ({ ...g, tabs: g.tabs.filter((t) => PERSONAL_SEGMENTS.has(t.href.slice(base.length + 1))) }))
          .filter((g) => g.tabs.length > 0)
      : def;

  const sections: RailSection[] = visible.map((g) => {
    const items = g.tabs.map((t) => ({
      label: t.label,
      href: t.href,
      active: isActive(path, t.href, base),
      count: t.countKey ? counts?.[t.countKey] : undefined,
    }));
    return {
      key: g.key,
      label: g.label,
      short: g.short,
      icon: g.icon,
      items,
      count: items.reduce((n, i) => n + (i.count ?? 0), 0),
    };
  });

  return <SectionRailNav sections={sections} routeKey={path} ariaLabel={kind === "personal" ? "Workspace sections" : "Organization sections"} />;
}
