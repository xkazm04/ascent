"use client";

// Two-level section nav: a narrow icon rail of top-level groups (level 1) beside a panel that lists
// only the selected group's pages (level 2) — so a surface with ~20 views never stacks them into one
// tall column the way the flat SideNav must.
//
// The panel follows the current route: it opens the group that owns the active item. Clicking a rail
// group *previews* that group's pages without navigating, and a real navigation snaps the panel back
// to the group that owns the route. Nothing is persisted — the route is the source of truth, and the
// preview is ephemeral. While a preview is showing, the group that owns the route keeps a dot so the
// rail never loses the "you are here".
//
// On small screens both levels degrade to horizontal scrollers stacked two rows deep.

import { useId, useState } from "react";
import { Kicker } from "./Kicker";
import { NavBadge, NavItem } from "./navItem";
import type { SideNavItem } from "./navItem";

export interface RailSection {
  /** Stable id, and the identity the panel is keyed on. */
  key: string;
  /** Full name — the panel eyebrow, the mobile chip, and the rail button's tooltip. */
  label: string;
  /** Abbreviated name for the desktop rail. Falls back to `label`. */
  short?: string;
  icon: React.ReactNode;
  items: SideNavItem[];
  /** Sum of the section's items' counts — the aggregate badge. Zero renders nothing. */
  count?: number;
}

function RailButton({
  section,
  shown,
  onRoute,
  panelId,
  onSelect,
}: {
  section: RailSection;
  /** This group's pages are the ones in the panel right now. */
  shown: boolean;
  /** This group owns the active route (may differ from `shown` while previewing). */
  onRoute: boolean;
  panelId: string;
  onSelect: () => void;
}) {
  const count = section.count ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={shown}
      aria-controls={panelId}
      title={section.label}
      className={
        "focus-ring relative flex shrink-0 items-center gap-3 rounded-md px-3 py-2 transition " +
        "lg:w-full lg:flex-col lg:gap-2.5 lg:px-1 lg:py-3 " +
        (shown ? "bg-accent/10 text-white" : "text-slate-400 hover:bg-surface/60 hover:text-white")
      }
    >
      {/* The badge hangs off the glyph rather than the button corner, so it reads as "this many
          things live behind this icon" and never collides with the current-section bar. */}
      <span className={`relative shrink-0 ${shown ? "text-accent" : "text-current"}`}>
        {section.icon}
        {count > 0 && <NavBadge count={count} className="absolute -right-3 -top-2.5 ring-2 ring-ink" />}
      </span>
      {/* mobile chip carries the full name; the narrow desktop rail takes the abbreviation */}
      <span className="font-mono text-xs uppercase tracking-[0.14em] lg:hidden">{section.label}</span>
      <span className="hidden font-mono text-[11px] font-medium uppercase leading-none tracking-[0.05em] lg:block">
        {section.short ?? section.label}
      </span>
      {/* The current-page marker, the same left accent bar the level-2 items use — so "current" reads
          identically at both levels, and a preview of another section never hides where you are. */}
      {onRoute && (
        <>
          <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent lg:inset-y-2.5" />
          <span className="sr-only">(contains the current page)</span>
        </>
      )}
      {count > 0 && <span className="sr-only">, {count} awaiting a decision</span>}
    </button>
  );
}

export function SectionRailNav({
  sections,
  routeKey,
  ariaLabel,
  className = "",
}: {
  sections: RailSection[];
  /** Changes on every navigation — resets the preview so the panel follows the route. */
  routeKey: string;
  ariaLabel: string;
  className?: string;
}) {
  const uid = useId();
  const panelId = `${uid}-panel`;

  // The group that owns the active route — the panel's default.
  const routeSection = sections.find((s) => s.items.some((i) => i.active)) ?? sections[0];

  // A previewed group (rail click) overrides that default until the route changes. Reset it during
  // render when the route moves (the sanctioned "adjust state from a prior render" pattern) rather
  // than in an effect, so the panel never paints a stale section for a frame.
  const [preview, setPreview] = useState<string | null>(null);
  const [seen, setSeen] = useState(routeKey);
  if (seen !== routeKey) {
    setSeen(routeKey);
    setPreview(null);
  }

  const shown = sections.find((s) => s.key === preview) ?? routeSection;
  if (!shown) return null;

  return (
    <nav aria-label={ariaLabel} className={`flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0 ${className}`}>
      {/* level 1 — the section rail */}
      <div className="flex gap-1 overflow-x-auto pb-1 lg:w-[92px] lg:shrink-0 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:border-r lg:border-divider lg:pb-0 lg:pr-2.5">
        {sections.map((s) => (
          <RailButton
            key={s.key}
            section={s}
            shown={s.key === shown.key}
            onRoute={s.key === routeSection?.key}
            panelId={panelId}
            onSelect={() => setPreview(s.key)}
          />
        ))}
      </div>

      {/* level 2 — the shown section's pages. Keyed on the section so the swap replays the fade. */}
      <div className="min-w-0 flex-1 lg:pl-2.5">
        <Kicker tone="muted" className="hidden px-3 pb-1.5 lg:block">
          {shown.label}
        </Kicker>
        <div
          key={shown.key}
          id={panelId}
          className="animate-fade-in flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0"
        >
          {shown.items.map((it, i) => (
            <NavItem key={i} item={it} />
          ))}
        </div>
      </div>
    </nav>
  );
}
