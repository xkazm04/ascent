// The Front page masthead: the ONE focal element (the standing figure, typeset in its level colour),
// its level word, its period delta, and the takeaway sentence whose second half is the page's single
// CTA — a link to the practice that lifts the dimension owing first. Beneath, in caption weight, the
// two halves that produce the figure (adoption · rigor) and the maturity trend as context.
// No hooks of its own (Sparkline is its own client island) — server-safe.

import Link from "next/link";
import { Sparkline, type TrendPoint } from "@/components/report/TrendChart";
import { deltaHex, fmtDelta } from "@/components/ui/format";
import { scoreHex } from "@/lib/ui";
import { buildUrl, clearedTabScopedParams, orgTabHref } from "@/lib/org/orgTabs";
import type { Standing, Takeaway } from "./overviewTakeaway";

/** Where "Testing owes first →" leads: the practice that lifts it, else the heatmap ranked on it. */
export function fixHref(slug: string, search: string, fix: NonNullable<Takeaway["fix"]>): string {
  return fix.practice
    ? `${orgTabHref(slug, "practices")}#practice-${fix.practice.id}`
    : `${buildUrl(slug, { ...clearedTabScopedParams(), dim: fix.dimId }, search)}#heatmap`;
}

export function OverviewFrontPageMasthead({
  standing: s,
  takeaway,
  trend,
  slug,
  search,
  deltaLabel,
}: {
  standing: Standing;
  takeaway: Takeaway;
  trend: { points: TrendPoint[]; label: string };
  slug: string;
  search: string;
  deltaLabel: string;
}) {
  const overall = s.overall ?? 0;
  const color = scoreHex(overall);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="type-figure-lg font-bold" style={{ color }}>
          {overall}
        </span>
        <span className="type-title font-semibold text-white">{s.levelName}</span>
        <span className="type-label tracking-[0.22em] text-slate-500">{s.levelId}</span>
        {s.delta !== null ? (
          <span className="type-mono-sm tabular-nums" style={{ color: deltaHex(s.delta) }}>
            {fmtDelta(s.delta)} <span className="text-slate-500">{deltaLabel}</span>
          </span>
        ) : (
          <span className="type-caption text-slate-500">no baseline {deltaLabel}</span>
        )}
      </div>

      <p className="type-lede mt-3 text-slate-100">
        {takeaway.lead}{" "}
        {takeaway.fix ? (
          <Link
            href={fixHref(slug, search, takeaway.fix)}
            className="focus-ring rounded text-accent transition hover:text-accent-soft"
            title={
              takeaway.fix.practice
                ? `Open the practice that lifts ${takeaway.fix.short}: ${takeaway.fix.practice.label}`
                : `Rank the fleet weakest-first on ${takeaway.fix.short}`
            }
          >
            {takeaway.action} →
          </Link>
        ) : (
          <span className="text-slate-400">{takeaway.action}</span>
        )}
      </p>

      <div className="type-caption mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 tabular-nums text-slate-400">
        {s.adoption !== null && (
          <span>
            AI adoption{" "}
            <span className="font-semibold" style={{ color: scoreHex(s.adoption) }}>
              {s.adoption}
            </span>
          </span>
        )}
        {s.rigor !== null && (
          <span>
            Engineering rigor{" "}
            <span className="font-semibold" style={{ color: scoreHex(s.rigor) }}>
              {s.rigor}
            </span>
          </span>
        )}
        {trend.points.length >= 2 && (
          <span className="flex items-center gap-2">
            Trend · {trend.label}
            <Sparkline points={trend.points} width={120} height={28} />
          </span>
        )}
      </div>
    </div>
  );
}
