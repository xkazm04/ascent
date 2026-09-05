"use client";

// Grouped left-navigation rail — the flat section nav for data-dense surfaces (the repo report) that
// have outgrown a horizontal tab bar. Vertical + grouped on lg+, and degrades to a horizontal scroller
// on small screens. When the group count grows past what one column can hold, reach for the two-level
// SectionRailNav instead (the org dashboard's nav).

import { Kicker } from "./Kicker";
import { NavItem } from "./navItem";
import type { SideNavItem } from "./navItem";

export type { SideNavItem } from "./navItem";

export interface SideNavGroup {
  label?: string;
  items: SideNavItem[];
}

export function SideNav({
  groups,
  ariaLabel,
  className = "",
}: {
  groups: SideNavGroup[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      // Below lg the rail scrolls horizontally; the right-edge fade (mask-image) signals that items
      // continue past the edge — without it trailing tabs were undiscoverable. lg+ removes the mask.
      className={`flex gap-1 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-1.75rem),transparent)] lg:flex-col lg:gap-0 lg:overflow-visible lg:pb-0 lg:[mask-image:none] ${className}`}
    >
      {groups.map((g, gi) => (
        // role="group" + aria-label keep the group name in the a11y tree below lg, where the visible
        // Kicker label is display:none — SR users still hear which section a tab belongs to.
        <div key={gi} role={g.label ? "group" : undefined} aria-label={g.label} className="flex items-center gap-1 lg:block lg:gap-0">
          {/* visible group label (lg only — the horizontal mobile rail stays compact; the group's
              aria-label above carries the name on small screens) */}
          {g.label && <Kicker tone="muted" className="hidden px-3 pb-1 pt-4 first:pt-0 lg:block">{g.label}</Kicker>}
          {/* vertical hairline between groups on the mobile scroller */}
          {gi > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-divider lg:hidden" />}
          <div className="flex gap-1 lg:flex-col lg:gap-0.5">
            {g.items.map((it, i) => (
              <NavItem key={i} item={it} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
