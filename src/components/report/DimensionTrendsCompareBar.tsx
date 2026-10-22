"use client";

// The "Compare two scans" control for DimensionTrends (trends-1). Off, it is one toggle button. On,
// the overall chart becomes a two-point picker and this bar says what to do next; once two points
// are picked it names the pair by date, older first (the baseline), and links the compare page's
// diff of exactly those two scans.

import Link from "next/link";
import { shortDateSafe } from "@/components/ui/format";

export interface PickedEnd {
  id: string;
  at: string;
}

export function DimensionTrendsCompareBar({
  active,
  onToggle,
  pickedCount,
  pair,
  href,
}: {
  active: boolean;
  onToggle: () => void;
  /** How many points are picked (0, 1 or 2). */
  pickedCount: number;
  /** The picked pair by role, once two points are picked. */
  pair: { before: PickedEnd; after: PickedEnd } | null;
  /** The pair's compare URL (null when the pair is not two real scans). */
  href: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 type-body-sm">
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className={`rounded-lg border px-3 py-1.5 transition ${
          active ? "border-accent text-white" : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
        }`}
      >
        {active ? "Done comparing" : "Compare two scans"}
      </button>
      {active && pair && href ? (
        <Link href={href} className="font-mono text-accent underline hover:text-white">
          Compare {shortDateSafe(pair.before.at)} → {shortDateSafe(pair.after.at)}
        </Link>
      ) : active ? (
        <span className="text-slate-500" aria-live="polite">
          {pickedCount === 0 ? "Pick two points on the chart." : "Pick one more point."}
        </span>
      ) : null}
    </div>
  );
}
