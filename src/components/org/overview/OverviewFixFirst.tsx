import Link from "next/link";
import type { FixFirstItem } from "@/components/org/overview/fixFirst";

// The Overview's "Fix first" punch-list band: up to three derived, triage-ordered priorities, each
// cell a single deep link to its evidence — the "so what do I do?" answer at the top of the page
// instead of leaving the reader to synthesize it from six sections. Derivation lives in fixFirst.ts
// (pure, unit-tested); the panel passes the finished items.

// Static class per column count — Tailwind can't compile a template-built `sm:grid-cols-${n}`.
const GRID_COLS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };

export function OverviewFixFirst({ items }: { items: FixFirstItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/[0.04] px-4 py-3">
      <div className="font-mono text-xs uppercase tracking-widest text-accent">Fix first</div>
      <div className={`mt-2 grid gap-3 sm:divide-x sm:divide-slate-800 ${GRID_COLS[items.length] ?? ""}`}>
        {items.map((it, i) => (
          <Link
            key={it.key}
            href={it.href}
            className="focus-ring group flex items-start gap-3 rounded-md sm:px-4 sm:first:pl-0 sm:last:pr-0"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 font-mono text-sm text-accent">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-white group-hover:text-accent">{it.title}</span>
              <span className="block text-sm text-slate-400">
                {it.detail} <span className="font-mono text-accent/80">{it.cta}</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
