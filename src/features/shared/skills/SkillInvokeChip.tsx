// "N ran" plus the last reporting client — extracted so SkillCard.tsx stays under the 200-LOC cap.
//
// WHY IT IS NOT LABELLED "30d". `SkillUsage.invokes` is volume across two sinks with two windows:
// sink A (events API: hook / CI / MCP) is an all-time groupBy with no window; sink B (registry
// `usage/`) is each contributor's declared window. The neighbouring Registry tab's `invokes30d` and
// `invokesDirect30d` ARE 30d rates. Calling this chip "invokes 30d" would paste that window onto a
// number nobody computed as a 30d rate. The title names both sinks and both windows; the dormancy
// badge beside it carries recency; the source chip names who last reported (`OrgSkillEvent.source`).
//
// Server-safe (no hooks): pure presentation over a server-computed verdict.

import { skillEventSourceLabel } from "@/lib/org/skill-event-source";
import type { SkillUsage } from "@/lib/org/skill-usage";

/** Sink A all-time; sink B per contributor. Not the Registry tab's 30d rate. */
export const INVOKE_CHIP_WINDOW = "all-time";

export const INVOKE_CHIP_TITLE =
  "Times this skill ran. Sink A (events API: Skill hook, CI, MCP) is all-time; sink B (registry usage/) uses each contributor's declared window. A volume, not the Registry tab's 30d rate.";

export const SOURCE_CHIP_TITLE =
  "Reporting client of the last recorded event. Closed set: CLI, Hook, CI, Web, Registry, MCP. Unattributed is a reporting gap, not a guess.";

export function SkillInvokeChip({ usage }: { usage: SkillUsage | undefined }) {
  // Zero invokes is not rendered as "0 ran" — that would read as a measurement when it is an absence.
  // A last-use source still renders on its own: a web copy is a use with a client and no invocation.
  if (!usage) return null;
  const ran = usage.invokes > 0;
  const showSource = Boolean(usage.lastUsedAt);
  if (!ran && !showSource) return null;
  const source = usage.lastUsedSource ?? null;
  return (
    <>
      {ran ? (
        <span
          className="font-mono text-slate-500"
          data-invoke-window={INVOKE_CHIP_WINDOW}
          data-invoke-sinks="A B"
          title={INVOKE_CHIP_TITLE}
        >
          {usage.invokes.toLocaleString()} ran
        </span>
      ) : null}
      {showSource ? (
        <span
          className="rounded border border-slate-800 px-1.5 py-0.5 type-caption text-slate-400"
          data-event-source={source ?? "unattributed"}
          title={SOURCE_CHIP_TITLE}
        >
          {skillEventSourceLabel(source)}
        </span>
      ) : null}
    </>
  );
}
