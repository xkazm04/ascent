"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SectionRailNav, type RailSection } from "@/components/ui";
// Type-only (erased at build): keeps the catalog's `countKey` honest against the shell's real counts.
import type { NavCounts } from "@/lib/org/nav-counts";
import {
  buildOrgTabUrl,
  DEFAULT_ORG_TAB,
  isMigratedOrgTab,
  ORG_NAV_GROUPS,
  orgTabHref,
  orgTabLabel,
  PERSONAL_TAB_IDS,
  resolveActiveOrgTab,
  type OrgTabId,
} from "@/lib/org/orgTabs";
import { AdminIcon, BoughtIcon, InFlightIcon, SharedIcon, StandingIcon } from "@/features/standing/overview/orgIcons";

/**
 * The org dashboard's section nav — the two-level rail (SectionRailNav): an icon rail of module
 * groups (Standing · Shared · In flight · Bought · Admin) beside a panel holding only the selected
 * group's tabs. Presentation is unchanged from the pre-refactor OrgNav; what moved is the
 * catalog (now src/lib/org/orgTabs.ts, so a server component can read it) and the navigation model:
 * a migrated tab is a `?tab=` push on the shell route instead of a full page navigation.
 *
 * A module carries a badge when it has items awaiting a decision. `counts` is keyed by tab id and
 * supplied by the shell (getNavCounts); a section's rail badge is the sum of its tabs', so a
 * collapsed group still tells you there's work inside it. See src/lib/org/nav-counts.ts.
 *
 * Every item is a real `<a href>` (orgTabHref) — middle-click and "open in new tab" still work, and
 * an un-migrated tab simply navigates to its legacy route.
 */

const ICONS: Record<string, React.ReactNode> = {
  standing: <StandingIcon size={24} />,
  shared: <SharedIcon size={24} />,
  inflight: <InFlightIcon size={24} />,
  bought: <BoughtIcon size={24} />,
  admin: <AdminIcon size={24} />,
};

export function OrgTabNav({
  slug,
  counts,
  kind = "org",
  landingTab = DEFAULT_ORG_TAB,
  activeOverride,
  hideTabs,
}: {
  slug: string;
  counts?: NavCounts;
  kind?: "org" | "personal";
  /** W1b — the tab a bare `/org/<slug>` renders (resolveLandingTab), threaded from the shell so the
   *  rail lights the panel the page actually showed instead of always assuming Overview. */
  landingTab?: OrgTabId;
  /** The rail item a page OUTSIDE the `?tab=` shell wants lit. `/org/developer` is a real rail item
   *  whose URL carries neither a `/org/<slug>/<tab>` segment nor `?tab=`, so the pathname alone
   *  cannot resolve it — the page states it instead (docs/REGISTRY-AND-CARE-IMPL.md §5.1). */
  activeOverride?: OrgTabId;
  /** Tabs the SHELL decided this deployment must not show (today: `pairing` on managed cloud, where
   *  a server-filesystem pairing is meaningless). Server-decided and threaded down — this client
   *  component can't read the deployment mode itself, and must not guess. */
  hideTabs?: readonly OrgTabId[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const active = activeOverride ?? resolveActiveOrgTab(pathname, params.get("tab"), landingTab);

  // a11y — on a tab switch, move focus to the <main> landmark (reusing the skip-link target) and
  // announce the newly active tab through a polite live region, so an AT user isn't left with a
  // silently swapped page. The prev comparison fires the effect ONLY on a real tab change: the very
  // first render (initial load / deep link) sees prev === active and skips, so we never steal focus
  // on load, and unrelated re-renders (count refreshes) don't re-announce.
  //
  // preventScroll is LOAD-BEARING, not a nicety. <main> is taller than the viewport and starts below
  // the org header, so a bare .focus() made the browser scroll it to the top of the scrollport — the
  // "the page jumps down by itself right after a tab renders" bug (worst on Follow-ups and
  // Repositories, whose tables are tall). That scroll also dragged the sticky left rail up to its
  // `top-20` perch, so the nav appeared to move on every tab click. `router.push(…, {scroll:false})`
  // below cannot prevent it: the scroll came from focus(), not from the navigation.
  const [announcement, setAnnouncement] = useState("");
  const prev = useRef(active);
  useEffect(() => {
    if (prev.current === active) return;
    prev.current = active;
    document.getElementById("main")?.focus({ preventScroll: true });
    setAnnouncement(`${orgTabLabel(active)} tab`);
  }, [active]);

  // Personal workspaces render the same rail from the same catalog, filtered to the individual
  // subset — one source of truth for labels/badges, so an org-nav change can't drift from it.
  const hidden = hideTabs && hideTabs.length > 0 ? new Set(hideTabs) : null;
  const groups = ORG_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((t) => (kind === "personal" ? PERSONAL_TAB_IDS.has(t.id) : true) && !hidden?.has(t.id)),
  })).filter((g) => g.items.length > 0);

  // push, NOT replace — a tab switch is the navigation users most expect Back to undo (replace made
  // `kp`'s workspace exit entirely). scroll:false keeps the reading position on the rail. The
  // tab-scoped param allowlist lives in orgTabs.ts, not at this call site.
  const select = (id: OrgTabId): void => {
    router.push(buildOrgTabUrl(slug, id, search), { scroll: false });
  };

  const sections: RailSection[] = groups.map((g) => {
    const items = g.items.map((t) => ({
      label: t.label,
      href: orgTabHref(slug, t.id),
      active: t.id === active,
      count: t.countKey ? counts?.[t.countKey] : undefined,
      // Only a migrated tab can be a same-route push; an un-migrated one keeps the default <Link>
      // navigation to its legacy route. Delete this branch when the migration completes.
      onSelect: isMigratedOrgTab(t.id) ? () => select(t.id) : undefined,
    }));
    return {
      key: g.key,
      label: g.label,
      short: g.short,
      icon: ICONS[g.key],
      items,
      count: items.reduce((n, i) => n + (i.count ?? 0), 0),
    };
  });

  return (
    <>
      {/* Polite live region: announces the active tab on a switch (focus moves to <main> above).
          Visually hidden; updated once per real switch. */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      <SectionRailNav
        sections={sections}
        // Changes on every navigation so the rail's group preview snaps back to the active route.
        routeKey={`${pathname}?${search}`}
        ariaLabel={kind === "personal" ? "Workspace sections" : "Organization sections"}
      />
    </>
  );
}
