// The DB half of skill dormancy. Split from skill-usage.ts because that module's types and label
// helpers are consumed by CLIENT components (SkillDormancyBadge inside the "use client" SkillsPanel):
// a single value import of a `@/lib/db` symbol drags Prisma — and with it dns/fs/net/tls — into the
// browser bundle, which typecheck and unit tests both happily ignore and only the build catches.
//
// Rule of thumb this file exists to enforce: anything a client component may import stays pure, and
// every read lives in a `-load` sibling that only server components touch.

import { getOrgSkillUsageRows } from "@/lib/db";
import { skillUsageMap, type SkillUsage } from "@/lib/org/skill-usage";

/** Server entry point: read + fold. {} when persistence is off or the org is unknown. */
export async function getOrgSkillUsage(orgSlug: string, now: Date = new Date()): Promise<Record<string, SkillUsage>> {
  const rows = await getOrgSkillUsageRows(orgSlug);
  return rows ? skillUsageMap(rows, now) : {};
}
