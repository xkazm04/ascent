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
      className={`flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0 lg:overflow-visible lg:pb-0 ${className}`}
    >
      {groups.map((g, gi) => (
        <div key={gi} className="flex items-center gap-1 lg:block lg:gap-0">
          {/* group label (lg only — the horizontal mobile rail stays compact) */}
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
