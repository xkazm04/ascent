// Dormancy badge for one org skill (src/lib/org/skill-usage.ts): new | active | dormant, with the last
// use in the tooltip. Server-computed — this is pure presentation, so no "use client" is needed.
//
// `new` is deliberately neutral, not green: a skill nobody has used yet hasn't earned "active", but
// branding it dormant on day one would train the org to ignore the badge entirely.
//
// The verdict is folded from the SAME writes as the "N uses" counter rendered beside it (see
// recordSkillDownload) — a card can no longer read "40 uses" and "dormant" at once.

import type { SkillUsage } from "@/lib/org/skill-usage";
import { usageVerdictLabel } from "@/lib/org/skill-usage";

const TONE: Record<SkillUsage["verdict"], string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  new: "border-slate-700 bg-slate-900 text-slate-400",
  dormant: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

/** "used 4 days ago" / "never used" — the evidence behind the verdict, never a bare adjective. */
export function usageDetail(u: SkillUsage): string {
  if (u.lastUsedAt === null || u.daysSinceUse === null) {
    return `never used · added ${u.ageDays === 0 ? "today" : `${u.ageDays}d ago`}`;
  }
  const when = u.daysSinceUse === 0 ? "today" : u.daysSinceUse === 1 ? "yesterday" : `${u.daysSinceUse}d ago`;
  const kind = u.lastUsedType === "download" ? "used" : "synced";
  return `${kind} ${when}`;
}

export function SkillDormancyBadge({ usage }: { usage: SkillUsage | undefined }) {
  if (!usage) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs ${TONE[usage.verdict]}`}
      title={`${usageVerdictLabel(usage.verdict)} — ${usageDetail(usage)}${
        usage.lastUsedAt ? ` (${usage.lastUsedAt.slice(0, 10)})` : ""
      }`}
    >
      {usageVerdictLabel(usage.verdict).toLowerCase()}
    </span>
  );
}
