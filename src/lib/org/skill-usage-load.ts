// The DB half of skill dormancy. Split from skill-usage.ts because that module's types and label
// helpers are consumed by CLIENT components (SkillDormancyBadge inside the "use client" SkillsPanel):
// a single value import of a `@/lib/db` symbol drags Prisma — and with it dns/fs/net/tls — into the
// browser bundle, which typecheck and unit tests both happily ignore and only the build catches.
//
// Rule of thumb this file exists to enforce: anything a client component may import stays pure, and
// every read lives in a `-load` sibling that only server components touch.
//
// Cadence is declared in SKILL.md frontmatter, not a column. This file attaches `cadenceDays` (from
// the stored body, else the list row's resolved frontmatter) before the fold, so a quarterly skill
// is judged against its own window rather than the 30-day floor.

import { getOrgSkillUsageRows, listOrgSkills } from "@/lib/db";
import { cadenceDaysFromFrontmatter } from "@/lib/org/skill-frontmatter";
import { skillUsageMap, type SkillUsage } from "@/lib/org/skill-usage";

/** Server entry point: read + fold. {} when persistence is off or the org is unknown. */
export async function getOrgSkillUsage(orgSlug: string, now: Date = new Date()): Promise<Record<string, SkillUsage>> {
  const rows = await getOrgSkillUsageRows(orgSlug);
  if (!rows) return {};
  const listed = await listOrgSkills(orgSlug).catch(() => []);
  const cadenceById = new Map<string, number | null>();
  for (const s of listed ?? []) {
    cadenceById.set(s.id, s.frontmatter.cadenceDays ?? cadenceDaysFromFrontmatter(s.content));
  }
  return skillUsageMap(
    {
      ...rows,
      skills: rows.skills.map((s) => ({
        ...s,
        cadenceDays: cadenceById.get(s.id) ?? cadenceDaysFromFrontmatter(s.content ?? ""),
      })),
    },
    now,
  );
}
