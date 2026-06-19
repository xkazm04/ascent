"use client";

// Grouped left-navigation rail — the canonical section nav for data-dense surfaces (org dashboards,
// the repo report) that have outgrown a horizontal tab bar. Vertical + grouped on lg+, and degrades
// to a horizontal scroller on small screens. Items can be route links (`href`) or in-component tabs
// (`onSelect`), so the same rail serves the route-based org nav and the state-based report tabs.

import Link from "next/link";
import { Kicker } from "./Kicker";

export interface SideNavItem {
  label: React.ReactNode;
  /** Route-based item (org). */
  href?: string;
  /** State-based item (report tabs). */
  onSelect?: () => void;
  active: boolean;
  /** Optional trailing hint (a count/badge). */
  hint?: React.ReactNode;
}

export interface SideNavGroup {
  label?: string;
  items: SideNavItem[];
}

function itemClass(active: boolean): string {
  return (
    "focus-ring relative flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 " +
    "text-base font-medium transition " +
    (active
      ? // mobile: an accent-tinted pill; lg: a left accent bar (the rail marker) over a faint wash
        "bg-accent/10 text-white lg:before:absolute lg:before:inset-y-1 lg:before:left-0 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-accent"
      : "text-slate-400 hover:bg-surface/60 hover:text-white")
  );
}

function ItemBody({ item }: { item: SideNavItem }) {
  return (
    <>
      <span>{item.label}</span>
      {item.hint != null && <span className="font-mono text-xs text-slate-500">{item.hint}</span>}
    </>
  );
}

function NavItem({ item }: { item: SideNavItem }) {
  const cls = itemClass(item.active);
  if (item.href) {
    return (
      <Link href={item.href} aria-current={item.active ? "page" : undefined} className={cls}>
        <ItemBody item={item} />
      </Link>
    );
  }
  return (
    <button type="button" onClick={item.onSelect} aria-current={item.active ? "page" : undefined} className={cls}>
      <ItemBody item={item} />
    </button>
  );
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
