// StatTile + StatStrip — the headline-number composition. A strip is a hairline-bed ledger of opaque
// cells (the frame supplies border and radius); a tile is one cell wrapping the brand Stat, optionally a
// deep link to the number's evidence. Same markup as the org Tile/TILE_GRID it replaces.
import { Stat, type StatProps } from "@/components/ui/Stat";

const LEDGER = "grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider";
const COLS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  6: "sm:grid-cols-3 lg:grid-cols-6",
} as const;

export function StatStrip({
  children,
  cols = 4,
  className = "",
}: {
  children: React.ReactNode;
  cols?: keyof typeof COLS;
  className?: string;
}) {
  return (
    <div data-kit="stat-strip" data-role="stat-strip" className={`${LEDGER} ${COLS[cols]} ${className}`}>
      {children}
    </div>
  );
}

export function StatTile({ href, ...stat }: StatProps & { href?: string }) {
  const body = <Stat {...stat} />;
  if (href) {
    return (
      <a href={href} data-kit="stat-tile" data-role="stat-tile" className="focus-ring block bg-ink px-5 py-3.5 transition-colors hover:bg-slate-900">
        {body}
      </a>
    );
  }
  return (
    <div data-kit="stat-tile" data-role="stat-tile" className="bg-ink px-5 py-3.5">
      {body}
    </div>
  );
}
