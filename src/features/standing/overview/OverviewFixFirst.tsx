import { Kicker } from "@/components/ui";
import { ListRow, ListRows, Panel } from "@/components/kit";
import { Legend, WhyChip, type VizState } from "@/components/org/viz";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
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
//
// Pending is not empty. `items=[]` still returns null (resolved: nothing to fix). The wait is
// OverviewFixFirstGap — a reserved-height OrgTabGap — so a still-streaming band does not read as
// "no priorities" and the fleet panel below does not jump into the hole.

// Kit order, filtered to the states this band actually contains — a legend teaching an encoding
// nothing on screen uses is the prose problem in another costume (Legend.tsx's own rule).
const KIT_ORDER: VizState[] = ["measured", "missing"];

/** Quiet reserved height while the punch-list streams. Compact band, not the fleet panel. */
export function OverviewFixFirstGap() {
  return <OrgTabGap minH="min-h-[8rem]" />;
}

export function OverviewFixFirst({ items }: { items: FixFirstItem[] }) {
  if (items.length === 0) return null;
  const impacts = items.map((i) => i.impact);
  const max = impactScaleMax(impacts);
  const present = new Set(impacts.map((i) => i.state));
  const states = KIT_ORDER.filter((s) => present.has(s));

  return (
    <Panel tone="accent" pad="none" className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Kicker>Fix first</Kicker>
        <WhyChip
          label="what the bars measure"
          hint={`Each bar is the projected gain in ${IMPACT_UNIT}, on one shared scale. A repository's regression is divided across the repositories compared this period before it may sit on a fleet scale. The numerals are triage precedence, not bar order.`}
        />
      </div>

      <ListRows className="mt-2.5">
        {items.map((it, i) => (
          <ListRow
            key={it.key}
            href={it.href}
            leading={i + 1}
            leadingTitle="Triage precedence: a live regression, then a queue awaiting a decision, then a slipping goal. Not a ranking by projected gain."
            title={it.title}
            detail={
              <>
                {it.detail} <span className="font-mono text-accent/80">{it.cta}</span>
              </>
            }
            trailing={<FixFirstImpactBar impact={it.impact} max={max} subject={it.title} />}
          />
        ))}
      </ListRows>

      <Legend states={states} className="mt-3 border-t border-accent/15 pt-2.5" />
    </Panel>
  );
}
