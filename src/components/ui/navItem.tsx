"use client";

// The leaf nav item, shared by the flat SideNav and the two-level SectionRailNav so the two rails
// carry one active-state treatment. Items can be route links (`href`) or in-component tabs
// (`onSelect`), so the same item serves route-based navs and state-based report tabs.

import Link from "next/link";

export interface SideNavItem {
  label: React.ReactNode;
  /** Route-based item (org). */
  href?: string;
  /**
   * State-based item (report tabs). When supplied ALONGSIDE `href` it intercepts a plain left-click
   * and runs instead of the default navigation — the org tab rail uses this to `router.push(…,
   * { scroll: false })`. The element stays a real `<a href>`, so middle-click, ctrl/cmd-click,
   * "open in new tab" and a crawler all still resolve the URL.
   */
  onSelect?: () => void;
  active: boolean;
  /** Optional trailing hint (a muted count, e.g. "how many things are on this page"). */
  hint?: React.ReactNode;
  /**
   * Items on this page awaiting a decision. Renders an accent badge — a stronger claim than `hint`,
   * so only pass a number that goes DOWN when the user acts. Zero and undefined both render nothing.
   */
  count?: number;
}

/**
 * The unresolved-work badge. Accent-filled because it is a call to action, not a statistic — the one
 * place in the nav that earns the accent besides the active marker. Capped at "99+" so a neglected
 * backlog can't widen the rail. `aria-hidden`: callers pair it with their own screen-reader text, so
 * the count is announced as part of the item's name rather than as a stray number.
 */
export function NavBadge({ count, className = "" }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold leading-[1.125rem] tabular-nums text-on-accent ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function navItemClass(active: boolean): string {
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
  const count = item.count ?? 0;
  return (
    <>
      <span>{item.label}</span>
      {count > 0 ? (
        <>
          <NavBadge count={count} />
          <span className="sr-only">, {count} awaiting a decision</span>
        </>
      ) : (
        item.hint != null && <span className="font-mono text-xs text-slate-500">{item.hint}</span>
      )}
    </>
  );
}

/** A plain left-click — the only kind an in-page handler may swallow. Anything with a modifier (or a
 *  non-primary button) is the user explicitly asking the browser for its own behaviour. */
function isPlainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function NavItem({ item }: { item: SideNavItem }) {
  const cls = navItemClass(item.active);
  if (item.href) {
    const { href, onSelect } = item;
    return (
      <Link
        href={href}
        onClick={
          onSelect
            ? (e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                onSelect();
              }
            : undefined
        }
        aria-current={item.active ? "page" : undefined}
        className={cls}
      >
        <ItemBody item={item} />
      </Link>
    );
  }
  // State-based tab (report): selecting it swaps in-component state rather than navigating, so
  // `aria-current="page"` (announced as "current page") is the wrong token. Use `aria-current="true"`
  // — "the current item within a set" — which a screen reader announces as "current" without implying
  // a page navigation that never happens.
  return (
    <button type="button" onClick={item.onSelect} aria-current={item.active ? "true" : undefined} className={cls}>
      <ItemBody item={item} />
    </button>
  );
}
