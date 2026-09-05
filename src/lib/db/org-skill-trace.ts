// `OrgSkillTrace` — the per-skill git timeline, cached (#36).
//
// A CACHE, keyed on the registry's head sha. That is what makes the Trace panel affordable: reading
// commits and blobs on every panel open would be a handful of GitHub calls per skill per viewer, so
// a hit is one DB read and a miss is paid once per head. When the registry moves the key changes and
// the next reader rebuilds it — no invalidation logic, because there is nothing to get wrong.
//
// Not barrel-exported by this module's own initiative (the barrel line is requested at merge).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import type { SkillTraceEntry } from "@/lib/registry/trace";

/** One cached timeline, client-facing: every timestamp is an ISO string. */
export interface SkillTraceRow {
  skillName: string;
  registryPath: string;
  /** The registry head this was built at. Compare it with `OrgRegistry.lastIndexSha` for freshness. */
  headSha: string;
  entries: SkillTraceEntry[];
  /** More commits exist for the path than the read budget took. */
  truncated: boolean;
  builtAt: string;
}

function parseEntries(raw: string): SkillTraceEntry[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as SkillTraceEntry[]) : [];
  } catch {
    return [];
  }
}

/** The cached trace for one skill, or null when nothing is cached. */
export async function getSkillTrace(registryId: string, registryPath: string): Promise<SkillTraceRow | null> {
  if (!isDbConfigured()) return null;
  const row = await getPrisma().orgSkillTrace.findUnique({
    where: { registryId_registryPath: { registryId, registryPath } },
  });
  if (!row) return null;
  return {
    skillName: row.skillName,
    registryPath: row.registryPath,
    headSha: row.headSha,
    entries: parseEntries(row.entriesJson),
    truncated: row.truncated,
    builtAt: row.builtAt.toISOString(),
  };
}

/** Write (or refresh) one skill's cached timeline. */
export async function putSkillTrace(input: {
  registryId: string;
  orgId: string;
  skillName: string;
  registryPath: string;
  headSha: string;
  entries: SkillTraceEntry[];
  truncated: boolean;
}): Promise<void> {
  if (!isDbConfigured()) return;
  const data = {
    skillName: input.skillName,
    headSha: input.headSha,
    entriesJson: JSON.stringify(input.entries),
    truncated: input.truncated,
    builtAt: new Date(),
  };
  await getPrisma()
    .orgSkillTrace.upsert({
      where: { registryId_registryPath: { registryId: input.registryId, registryPath: input.registryPath } },
      update: data,
      create: { registryId: input.registryId, orgId: input.orgId, registryPath: input.registryPath, ...data },
    })
    // Best-effort: a cache that could not be written costs the next reader a rebuild, nothing more.
    .catch(() => {});
}
