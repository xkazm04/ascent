// Pending `invoke` events: a registry skill an agent ran BEFORE the indexer mirrored it (backlog
// develop-2026-09-17 row 5).
//
// THE RACE. An agent works from a registry checkout, so it can run `skills/deploy-check` the minute the
// file merges. The library only learns the skill exists on the next index pass. `report_skill_invoke`
// used to answer that window with a hard refusal and write nothing, so the invocation was lost and the
// skill later read as unused by the one agent that had actually used it.
//
// THE SHAPE. The event is written to `OrgSkillEvent` under a SYNTHETIC skill id, `registry:<name>` —
// the same key the registry `usage/` lane already uses for a skill this org has not mirrored
// (`unmirroredSkillId`). `OrgSkillEvent` has no FK (relationMode="prisma"), so no schema change is
// needed, and a real `OrgSkill.id` is a uuid/cuid that cannot start with `registry:`. No `OrgSkill` row
// is invented: a pending event is residue waiting for a row, never a row.
//
// THE ATTACH. `upsertRegistrySkill` calls `attachPendingSkillInvokes` once it knows the mirrored row's
// id, and the pending rows are re-keyed onto it (skill id AND dedupe key, since the key hashes the skill
// id). A row whose re-computed key already exists under the real id is the same invocation reported
// twice — once before the mirror, once after — and is deleted rather than counted again. Re-keyed
// invokes bump the use tally exactly as `recordSkillEvents` does, so "N uses" and the dormancy badge
// keep agreeing.
//
// Every read that folds events by skill id already filters to the library's own ids, so an unattached
// row cannot vote on a library verdict; `listSkillInvokeAnchors` excludes the prefix explicitly.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { clampEventTs, skillEventDedupeKey } from "@/lib/db/org-skills";
import { slugifySkillName } from "@/lib/org/skill-frontmatter";
import { unmirroredSkillId } from "@/lib/registry/usage-samples";

export interface PendingInvokeInput {
  /** The skill name as the agent reported it. Normalized with the indexer's own slug rule, so the key
   *  matches the name the mirrored row will carry. */
  name: string;
  session: string;
  repo?: string | null;
  ts?: string | null;
}

const clip = (v?: string | null) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * Record one invoke against a registry skill NAME that has no `OrgSkill` row yet. `null` = persistence
 * off; `{ recorded: 0 }` = a replay of an event already held, or a name that slugs to nothing.
 * Tenant-bounded by construction: the row carries the caller's `orgId`, and attach matches on it.
 */
export async function recordPendingSkillInvoke(
  orgSlug: string,
  input: PendingInvokeInput,
): Promise<{ recorded: number; name: string } | null> {
  if (!isDbConfigured()) return null;
  const name = slugifySkillName(input.name);
  if (!name) return { recorded: 0, name };
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { recorded: 0, name };
  const skillId = unmirroredSkillId(name);
  const at = clampEventTs(input.ts, new Date());
  const sessionId = clip(input.session);
  const dedupeKey = skillEventDedupeKey(sessionId, skillId, at);
  if (dedupeKey) {
    const held = await prisma.orgSkillEvent.findFirst({ where: { orgId, skillId, dedupeKey }, select: { id: true } });
    if (held) return { recorded: 0, name };
  }
  const { count } = await prisma.orgSkillEvent.createMany({
    data: [{ skillId, orgId, type: "invoke", repo: clip(input.repo), source: "mcp", detail: null, sessionId, dedupeKey, createdAt: at }],
    skipDuplicates: true,
  });
  return { recorded: count, name };
}

/**
 * Re-key every pending event held under `name` in `orgId` onto the mirrored skill `skillId`. Returns how
 * many rows were attached. Best-effort: a failure costs the pending rows one more pass, never the index.
 */
export async function attachPendingSkillInvokes(orgId: string, skillId: string, name: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const key = slugifySkillName(name);
  if (!key) return 0;
  try {
    const prisma = getPrisma();
    const pending = await prisma.orgSkillEvent.findMany({
      where: { orgId, skillId: unmirroredSkillId(key) },
      select: { id: true, type: true, sessionId: true, createdAt: true },
    });
    if (!pending.length) return 0;
    let attached = 0;
    let uses = 0;
    for (const row of pending) {
      const dedupeKey = skillEventDedupeKey(row.sessionId, skillId, row.createdAt);
      const twin = dedupeKey
        ? await prisma.orgSkillEvent.findFirst({ where: { orgId, skillId, dedupeKey }, select: { id: true } })
        : null;
      if (twin) {
        await prisma.orgSkillEvent.delete({ where: { id: row.id } });
        continue;
      }
      await prisma.orgSkillEvent.update({ where: { id: row.id }, data: { skillId, dedupeKey } });
      attached++;
      if (row.type === "invoke" || row.type === "download") uses++;
    }
    if (uses) {
      const now = new Date();
      await prisma.$transaction([
        prisma.orgSkillDownload.upsert({
          where: { skillId },
          update: { count: { increment: uses }, lastSeen: now },
          create: { skillId, count: uses },
        }),
        prisma.orgSkill.update({ where: { id: skillId }, data: { downloadCount: { increment: uses } } }),
      ]);
    }
    return attached;
  } catch {
    return 0;
  }
}
