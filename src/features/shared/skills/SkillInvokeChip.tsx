// "N ran" — the invocation half of a skill's use count (#19), extracted rather than appended so
// SkillCard.tsx stays under the 200-LOC features cap.
//
// WHY IT IS NOT LABELLED "30d". `SkillUsage.invokes` is volume across two sinks with two windows:
// sink A (events API: hook / CI / MCP) is an all-time groupBy with no window; sink B (registry
// `usage/`) is each contributor's declared window. The neighbouring Registry tab's `invokes30d` and
// `invokesDirect30d` ARE 30d rates. Calling this chip "invokes 30d" would paste that window onto a
// number nobody computed as a 30d rate. The title names both sinks and both windows; the dormancy
// badge beside it carries recency.
//
// Server-safe (no hooks): pure presentation over a server-computed verdict.

import type { SkillUsage } from "@/lib/org/skill-usage";

/** Sink A all-time; sink B per contributor. Not the Registry tab's 30d rate. */
export const INVOKE_CHIP_WINDOW = "all-time";

export const INVOKE_CHIP_TITLE =
  "Times this skill ran. Sink A (events API: Skill hook, CI, MCP) is all-time; sink B (registry usage/) uses each contributor's declared window. A volume, not the Registry tab's 30d rate.";

export function SkillInvokeChip({ usage }: { usage: SkillUsage | undefined }) {
  // Zero is not rendered. A skill with no invocations is either uninstrumented or genuinely unrun,
  // and the badge next to this already carries that distinction honestly — a bare "0 ran" would read
  // as a measurement when it is an absence.
  if (!usage || usage.invokes <= 0) return null;
  return (
    <span
      className="font-mono text-slate-500"
      data-invoke-window={INVOKE_CHIP_WINDOW}
      data-invoke-sinks="A B"
      title={INVOKE_CHIP_TITLE}
    >
      {usage.invokes.toLocaleString()} ran
    </span>
  );
}
