// GET /api/org/:slug/registry/trace?skill=<name> -> the skill's version timeline + its lessons (#36)
//
// ON DEMAND, and cached per registry head. A cache hit is ONE database read; a miss costs the
// commit list plus at most `TRACE_VERSION_READS` blob reads, paid once per head rather than once per
// viewer. Building this in the index pass instead would multiply those reads by every skill in the
// registry on every push, which is why it lives here.
//
// The escalation is deliberate and narrow: reading the panel is `guardRegistryRead` (any member),
// and only a cache MISS mints an installation token, at the `member` floor — the same floor
// `POST .../registry/index` uses, because both only re-read content the org already owns and write
// nothing to GitHub.
//
// A GitHub failure degrades to `{ entries: [], error }` and the panel says "history unavailable".
// An empty timeline presented as "no history" would be a claim about the skill; this is a claim
// about the request.

import { NextResponse } from "next/server";
import { getOrgId } from "@/lib/db/org-rollup";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { guardRegistryRead, guardRegistryWrite, registryError } from "@/lib/registry/api";
import { getSkillTrace, putSkillTrace } from "@/lib/db/org-skill-trace";
import { listSkillLessons } from "@/lib/db/org-skill-lessons";
import { listPathCommits, readFileAtRef } from "@/lib/registry/read";
import { parseRegistrySkill } from "@/lib/registry/parse";
import { parseFullName, REGISTRY_DIRS, REGISTRY_SKILL_FILE } from "@/lib/registry/layout";
import { buildTrace, TRACE_COMMITS, TRACE_VERSION_READS, type SkillTraceEntry } from "@/lib/registry/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A registry skill name, as it appears in a directory. Anything else cannot address a path. */
const SKILL_NAME = /^[A-Za-z0-9._-]{1,80}$/;

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const denied = await guardRegistryRead(slug);
  if (denied) return denied;

  const skill = new URL(request.url).searchParams.get("skill")?.trim() ?? "";
  if (!SKILL_NAME.test(skill)) return registryError("invalid-input", "Provide a valid `skill` name.", 400);

  const [registry, orgId] = await Promise.all([getOrgRegistry(slug).catch(() => null), getOrgId(slug).catch(() => null)]);
  if (!registry || !orgId) return registryError("not-mapped", "This organization has no registry mapped yet.", 409);

  const path = `${REGISTRY_DIRS.skills}/${skill}/${REGISTRY_SKILL_FILE}`;
  const lessons = await listSkillLessons(orgId, skill).catch(() => []);
  const headSha = registry.lastIndexSha ?? registry.defaultBranch ?? "HEAD";

  const cached = await getSkillTrace(registry.id, path).catch(() => null);
  if (cached && cached.headSha === headSha) {
    return NextResponse.json({ skill, path, headSha, entries: cached.entries, truncated: cached.truncated, lessons, cached: true });
  }

  const gate = await guardRegistryWrite(slug, { minRole: "member" });
  if (gate instanceof NextResponse) {
    // The viewer may read the tab but ascent cannot reach GitHub for them. Serve the STALE cache
    // when there is one, labelled as such — an older timeline is worth more than an empty one.
    if (cached) {
      return NextResponse.json({ skill, path, headSha: cached.headSha, entries: cached.entries, truncated: cached.truncated, lessons, cached: true, stale: true });
    }
    return NextResponse.json({ skill, path, headSha, entries: [], truncated: false, lessons, cached: false, error: "History is unavailable — Ascent cannot read this registry right now." });
  }

  const ref = parseFullName(registry.fullName);
  if (!ref) return registryError("invalid-input", `"${registry.fullName}" is not a valid repository name.`, 400);

  let entries: SkillTraceEntry[];
  let truncated = false;
  try {
    const log = await listPathCommits(gate.token, ref.owner, ref.repo, path, headSha, TRACE_COMMITS);
    truncated = log.truncated;
    const versions = new Map<string, string>();
    for (const c of log.commits.slice(0, TRACE_VERSION_READS)) {
      const text = await readFileAtRef(gate.token, ref.owner, ref.repo, path, c.sha);
      if (!text) continue;
      const parsed = parseRegistrySkill(path, text);
      if (parsed.ok && parsed.value.version) versions.set(c.sha, parsed.value.version);
    }
    entries = buildTrace(log.commits, versions);
  } catch (err) {
    return NextResponse.json({
      skill,
      path,
      headSha,
      entries: [],
      truncated: false,
      lessons,
      cached: false,
      error: `History is unavailable — ${err instanceof Error ? err.message : "GitHub could not be reached"}.`,
    });
  }

  await putSkillTrace({ registryId: registry.id, orgId, skillName: skill, registryPath: path, headSha, entries, truncated });
  return NextResponse.json({ skill, path, headSha, entries, truncated, lessons, cached: false });
}
