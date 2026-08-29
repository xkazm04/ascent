// "N ran" — the invocation half of a skill's use count (#19), extracted rather than appended so
// SkillCard.tsx stays under the 200-LOC features cap.
//
// WHY IT IS NOT LABELLED "30d". `SkillUsage.invokes` is the ALL-TIME rollup of `invoke` events plus
// whatever the registry's `usage/` samples report — the DB rollup is a groupBy with no window, and
// each contributor counts over a window it chose for itself. Calling that "invokes 30d" on a card
// would be a precise-sounding number nobody computed. The recency claim lives in the dormancy badge
// beside it, which IS windowed; this is a volume, and it says so.
//
// Server-safe (no hooks): pure presentation over a server-computed verdict.

import type { SkillUsage } from "@/lib/org/skill-usage";

export function SkillInvokeChip({ usage }: { usage: SkillUsage | undefined }) {
  // Zero is not rendered. A skill with no invocations is either uninstrumented or genuinely unrun,
  // and the badge next to this already carries that distinction honestly — a bare "0 ran" would read
  // as a measurement when it is an absence.
  if (!usage || usage.invokes <= 0) return null;
  return (
    <span
      className="font-mono text-slate-500"
      title="Times this skill actually RAN — the Skill hook, a CI job, the MCP tool path, and whatever the registry's usage lane reports. Counted over each reporter's own window, so it is a volume, not a rate."
    >
      {usage.invokes.toLocaleString()} ran
    </span>
  );
}
