import Link from "next/link";
import { Kicker } from "@/components/ui";
import { Legend, WhyChip, type VizState } from "@/components/org/viz";
import { FixFirstImpactBar } from "./FixFirstImpactBar";
import { IMPACT_UNIT, impactScaleMax } from "./fixFirstImpact";
import type { FixFirstItem } from "@/features/standing/overview/fixFirst";

// The Overview's "Fix first" band: up to three derived, triage-ordered priorities, each cell a deep
// link to its evidence — the "so what do I do?" answer at the top of the landing page. Derivation
// lives in fixFirst.ts and fixFirstImpact.ts (pure, unit-tested); this file only draws them.
//
// It used to be three sentences behind three numerals, which said which candidate the triage rules
// put first but never how much any of them was WORTH. Two candidates whose gains differ by a factor
// of thirty read identically in prose. So the band is now a ranked bar chart on one shared scale
// (fleet-average maturity points): labels on the left, bars on the right, the way MatrixGrid and
// StateTrack lay a subject against its marks.
//
// The bars introduce exactly one hazard — a reader who assumes the numerals rank by bar length. They
// do not: the numeral is TRIAGE precedence (a live regression outranks a queue awaiting a decision
// outranks a slipping goal) and it is deliberately unchanged, because a candidate with no scoring
// model has no bar at all and must not therefore sort last. The numeral's own title says so.

// Kit order, filtered to the states this band actually contains — a legend teaching an encoding
// nothing on screen uses is the prose problem in another costume (Legend.tsx's own rule).
const KIT_ORDER: VizState[] = ["measured", "missing"];

export function OverviewFixFirst({ items }: { items: FixFirstItem[] }) {
  if (items.length === 0) return null;
  const impacts = items.map((i) => i.impact);
  const max = impactScaleMax(impacts);
  const present = new Set(impacts.map((i) => i.state));
  const states = KIT_ORDER.filter((s) => present.has(s));

  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/[0.04] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Kicker>Fix first</Kicker>
        <WhyChip
          label="what the bars measure"
          hint={`Each bar is the projected gain in ${IMPACT_UNIT}, on one shared scale. A repository's regression is divided across the repositories compared this period before it may sit on a fleet scale. The numerals are triage precedence, not bar order.`}
        />
      </div>

      <ol className="mt-2.5 space-y-2">
        {items.map((it, i) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="focus-ring group grid grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-md py-1 sm:grid-cols-[minmax(0,1fr)_16rem]"
            >
              <span className="flex min-w-0 items-start gap-3">
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 type-mono-sm text-accent"
                  title="Triage precedence: a live regression, then a queue awaiting a decision, then a slipping goal. Not a ranking by projected gain."
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white group-hover:text-accent">{it.title}</span>
                  <span className="block type-body-sm text-slate-400">
                    {it.detail} <span className="font-mono text-accent/80">{it.cta}</span>
                  </span>
                </span>
              </span>
              <FixFirstImpactBar impact={it.impact} max={max} subject={it.title} />
            </Link>
          </li>
        ))}
      </ol>

      <Legend states={states} className="mt-3 border-t border-accent/15 pt-2.5" />
    </div>
  );
}
