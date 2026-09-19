// Dormancy badge for one org skill (src/lib/org/skill-usage.ts). Server-computed — pure presentation,
// so no "use client" is needed.
//
// THE BADGE USED TO CONFLATE THREE FACTS. `SkillUsage.state` splits `dormant` into `abandoned` (used,
// then silence), `unused` (never used, but this org's pathway demonstrably works) and `unmeasured`
// (no skill event of any kind has ever been recorded for this org). The badge rendered the COARSE
// verdict, so all three came out as one amber "dormant" — a skill nobody has ever measured wore the
// same warning as one the fleet tried and dropped, and the tooltip beside it said "never used", which
// is a measurement of absence taken from an instrument that was never switched on.
//
// The state is now the paint: the swatch is the same mark the tab's charts use (measured / declared /
// not-judged), the word is the finer state, and `usageDetail` refuses to claim "never used" for an
// unmeasured skill. `new` stays deliberately neutral rather than green — a skill nobody has used yet
// hasn't earned "active", but branding it dormant on day one would train the org to ignore the badge.

import { StateSwatch } from "@/components/org/viz";
import { usageBadgeLabel, usageDetail, usageVizState } from "@/features/shared/skills/skillLifecycleViz";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { usageStateLabel, usageVerdictLabel } from "@/lib/org/skill-usage";

/** Tone by STATE, not by verdict: only a skill the fleet really tried and dropped earns the amber
 *  warning. `unused` is a discovery problem and `unmeasured` is an absence of data — neither is a
 *  finding about the skill, so neither is painted as one. */
const TONE: Record<string, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  abandoned: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  dormant: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};
const NEUTRAL = "border-slate-700 bg-slate-900 text-slate-400";

export function SkillDormancyBadge({ usage }: { usage: SkillUsage | undefined }) {
  if (!usage) return null;
  const state = usageVizState(usage);
  const label = usageBadgeLabel(usage);
  const heading = usage.state ? usageStateLabel(usage.state) : usageVerdictLabel(usage.verdict);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 type-caption ${
        TONE[usage.state ?? usage.verdict] ?? NEUTRAL
      }`}
      title={`${heading}: ${usageDetail(usage)}${usage.lastUsedAt ? ` (${usage.lastUsedAt.slice(0, 10)})` : ""}`}
    >
      <StateSwatch state={state} size={9} />
      {label}
    </span>
  );
}
