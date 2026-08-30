"use client";

// One worklist row: the fix as a verb, how many repos it touches, what it buys the fleet — and,
// one click deeper, the repos themselves (weakest first, each opening its report) and the practice
// link. Compact 32px rhythm on hairline rules; the lift bar is the screen's only accent role.

import { useState } from "react";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import { reportPermalink, scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { CheapestRow } from "./cheapestPoints";

export function OverviewCheapestPointsRow({
  row,
  max,
  slug,
  verb,
}: {
  row: CheapestRow;
  /** The top row's lift — the bar's 100%. */
  max: number;
  slug: string;
  verb: string;
}) {
  const [open, setOpen] = useState(false);
  const width = max > 0 ? Math.max(4, Math.round((row.lift / max) * 100)) : 0;
  const practiceHref = row.practice ? `${orgTabHref(slug, "practices")}#practice-${row.practice.id}` : null;
  const detailId = `cheapest-${row.dimId}`;

  return (
    <li className="border-b border-divider">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring grid min-h-8 w-full grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_4.5rem] items-center gap-x-6 py-1.5 text-left transition-colors hover:bg-surface/40"
      >
        <span className="truncate type-body-sm text-white">{verb}</span>
        <span className="truncate type-note text-slate-500">
          {row.repos.length} of {row.of} repo{row.of === 1 ? "" : "s"} below {FOLLOW_UP_BELOW}
        </span>
        <span aria-hidden className="h-1.5 w-full rounded-full bg-surface-strong/60">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
        </span>
        <span className="type-mono-sm text-right text-white">+{row.lift.toFixed(1)}</span>
      </button>

      {open && (
        <div id={detailId} className="animate-expand-down">
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pb-3">
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {row.repos.map((r) => (
                  <li key={r.fullName}>
                    <a href={reportPermalink(r.fullName, null, slug)} className="focus-ring type-mono-sm text-slate-300 hover:text-white">
                      {r.name} <span style={{ color: scoreHex(r.score) }}>{r.score}</span>
                    </a>
                  </li>
                ))}
              </ul>
              {practiceHref && (
                <a href={practiceHref} className="focus-ring type-mono-sm text-accent hover:text-white">
                  Open the practice →
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
