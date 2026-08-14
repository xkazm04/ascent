// Dependency-free stroke icons for the org views (lucide visual language: 24 viewBox, currentColor,
// 1.75 round strokes) — replacing emoji so the fleet views read as one authentic icon system. Pure SVG,
// server-safe. `StackRoleIcon` maps a detected stack role to a legible glyph; the small UI icons
// (Filter / Chevron / Check) drive the header filter dropdowns.

import type { StackRole } from "@/lib/types";

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

const ROLE_PATHS: Record<Exclude<StackRole, "unknown">, React.ReactNode> = {
  // Frontend — a browser/layout window
  frontend: (
    <>
      <rect x="3" y="4" width="18" height="15" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="6.5" y1="6.5" x2="6.5" y2="6.5" />
    </>
  ),
  // Backend — stacked server racks
  backend: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <line x1="7" y1="7.5" x2="7" y2="7.5" />
      <line x1="7" y1="16.5" x2="7" y2="16.5" />
    </>
  ),
  // Mobile — a phone
  mobile: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <line x1="10.5" y1="18" x2="13.5" y2="18" />
    </>
  ),
  // Data / ML — a database cylinder
  data_ml: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  // Infra — a cloud
  infra: <path d="M6.5 18A4.5 4.5 0 0 1 6 9.05 6 6 0 0 1 17.7 7.5 3.75 3.75 0 0 1 17.5 18H6.5z" />,
  // Library — a package box
  library: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M4 7.5l8 4.5 8-4.5" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </>
  ),
};

export function StackRoleIcon({ role, size = 16, className }: { role: StackRole } & IconProps) {
  const path = role === "unknown" ? null : ROLE_PATHS[role];
  if (!path) return null;
  return (
    <Svg size={size} className={className}>
      {path}
    </Svg>
  );
}

// Section glyphs for the org rail's first level — one per module group (OrgTabNav, and the /about-org
// module map that derives from the same catalog). Sized 18 there, so they read at a glance beside a
// 10px mono label.
//
// W1a: these five replaced the six data-type glyphs (Overview/Fleet/Intelligence/Plan/Library/Govern)
// when the rail was regrouped around the transition journey. Each one is chosen to read as a VERB or
// a MOMENT rather than a category — the point of the regroup.

export function StandingIcon({ size = 18, className }: IconProps) {
  // Gauge — where we stand, read at a glance. (Kept from the old OverviewIcon: it was always the
  // right glyph for "the headline read", which is exactly what Standing opens with.)
  return (
    <Svg size={size} className={className}>
      <path d="M3.4 18a9 9 0 1 1 17.2 0" />
      <path d="M12 14l3.6-3.6" />
    </Svg>
  );
}

export function ChosenIcon({ size = 18, className }: IconProps) {
  // Planted flag — a decision taken and staked out: the plan, the practices, the declared stance.
  return (
    <Svg size={size} className={className}>
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4.5h11l-2.3 4 2.3 4h-11" />
    </Svg>
  );
}

export function InFlightIcon({ size = 18, className }: IconProps) {
  // Paper plane — work that has left the hangar: PRs open, gaps being worked. The literal glyph is
  // the right one here; anything more abstract reads as another category.
  return (
    <Svg size={size} className={className}>
      <path d="M20.5 3.5 10 14" />
      <path d="M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z" />
    </Svg>
  );
}

export function BoughtIcon({ size = 18, className }: IconProps) {
  // Receipt — a statement of what the period actually delivered. Deliberately an accounting glyph:
  // the Bought section reports VERIFIED movement only, never a projection.
  return (
    <Svg size={size} className={className}>
      <path d="M6 21V3.6a.6.6 0 0 1 .9-.5L9 4.3l2.1-1.2a.6.6 0 0 1 .6 0L14 4.3l2.1-1.2a.6.6 0 0 1 .9.5V21l-2.4-1.4-2.1 1.2a.6.6 0 0 1-.6 0L9.8 19.6 6 21Z" />
      <path d="M9.5 8.5h5" />
      <path d="M9.5 12.5h5" />
    </Svg>
  );
}

export function AdminIcon({ size = 18, className }: IconProps) {
  // Shield check — access, integrations, audit, settings.
  return (
    <Svg size={size} className={className}>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 8.7 4.1-.8 7-4.5 7-8.7V6l-7-3Z" />
      <path d="m9.2 11.8 2 2 3.6-3.6" />
    </Svg>
  );
}

export function FilterIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M5 12.5l4 4 10-10" />
    </Svg>
  );
}
