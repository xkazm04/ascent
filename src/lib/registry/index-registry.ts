// The indexer: read the registry repo at HEAD and rebuild ascent's mirror rows from it.
//
// The registry is the source of truth; this is the only thing that makes its contents visible to the
// Skills / Practices / Memory tabs, the fleet heatmap and the catalog. It runs on the registry repo's
// push webhook, on a scan of the org, and from the tab's "Re-index" button.
//
// RESILIENCE IS THE POINT: one malformed SKILL.md must degrade THAT FILE and nothing else. Every read
// and parse sits inside a guard, failures become `warnings` on the row, and the pass still commits
// every file that did parse. `indexRegistry` therefore NEVER throws — a total failure (no access,
// deleted repo, rate limit) comes back as `{ kind: "error" }`, leaving the previous index readable.
// Tree selection and capped reading live in `./index-walk`; this file is the orchestration.

import type { OrgRegistryRow } from "@/lib/db/org-registry";
import { archiveVanishedRegistryRows, recordIndexError, recordIndexResult } from "@/lib/db/org-registry-write";
import { upsertRegistryMemory, upsertRegistryPractice, upsertRegistrySkill } from "@/lib/db/org-registry-mirror";
import { buildCatalog, shortDigest, type RegistryCatalog } from "./catalog";
import { REGISTRY_CATALOG_PATH, REGISTRY_LESSONS_FILE, REGISTRY_SKILL_FILE, REGISTRY_SPINE_PATH } from "./layout";
import { cappedReader, countLessons, selectArtifacts, type RegistrySource } from "./index-walk";
import { contentDigest, parseRegistryMemory, parseRegistryPractice, parseRegistrySkill } from "./parse";
import { modeToYaml, parseRegistryYaml, type RegistryDeclaration } from "./policy";
import type { RegistryTree } from "./read";

export type { RegistrySource } from "./index-walk";
export { githubSource } from "./index-walk";

export interface IndexRegistryResult {
  kind: "ok" | "error";
  message?: string;
  headSha?: string;
  counts?: { skills: number; practices: number; memory: number; lessons: number };
  warnings?: string[];
  archived?: { skills: number; practices: number; memory: number };
  declaration?: RegistryDeclaration;
  /** The catalog this pass WOULD commit; writing it back is a separate, policy-gated step. */
  catalog?: RegistryCatalog;
}

/**
 * A mirror write that reports its own failure instead of aborting the pass.
 *
 * Counts and catalog describe the REGISTRY, not ascent's database — a file that parsed is part of the
 * registry's content whether or not its row landed. A failed write is therefore a warning against that
 * path, and a `null` (persistence off) is tallied into ONE aggregate warning instead of one per file.
 * Reporting "0 skills" for a registry that plainly has three is the bug this shape prevents.
 */
type WriteTally = { notPersisted: number };

async function mirror(path: string, warnings: string[], tally: WriteTally, write: () => Promise<string | null>) {
  try {
    if ((await write()) === null) tally.notPersisted++;
  } catch (err) {
    warnings.push(`${path}: mirror row not written (${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * Rebuild `registry`'s mirror rows from its repo at HEAD. Returns a typed result and persists it —
 * `recordIndexResult` on success, `recordIndexError` on a total failure (the previous index survives).
 */
export async function indexRegistry(registry: OrgRegistryRow, source: RegistrySource): Promise<IndexRegistryResult> {
  const warnings: string[] = [];
  const tally: WriteTally = { notPersisted: 0 };
  const seen = { skills: [] as string[], practices: [] as string[], memory: [] as string[] };
  const catalogSkills: RegistryCatalog["skills"] = [];
  const catalogPractices: RegistryCatalog["practices"] = [];
  const catalogMemory: RegistryCatalog["memory"] = [];
  let lessons = 0;

  let tree: RegistryTree;
  try {
    tree = await source.readTree(registry.defaultBranch || "main");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordIndexError(registry.id, message).catch(() => {});
    return { kind: "error", message };
  }
  if (tree.truncated) warnings.push("GitHub truncated the file tree — this index is partial.");

  const picked = selectArtifacts(tree, warnings);
  const read = cappedReader(source, warnings);

  // ── the spine: `.ascent/registry.yaml` decides mode, telemetry and policies ──
  const spine = picked.byPath.get(REGISTRY_SPINE_PATH);
  if (!spine) warnings.push(`${REGISTRY_SPINE_PATH} is missing — indexed with default policies.`);
  const spineText = spine ? await read(spine) : null;
  const declaration: RegistryDeclaration = parseRegistryYaml(spineText ?? "");

  // ── skills/<name>/SKILL.md (+ its LESSONS.md sibling) ──
  for (const entry of picked.skills) {
    const text = await read(entry);
    if (text === null) continue;
    const parsed = parseRegistrySkill(entry.path, text);
    if (!parsed.ok) {
      warnings.push(parsed.reason);
      continue;
    }
    warnings.push(...parsed.warnings);

    const lessonsEntry = picked.byPath.get(entry.path.replace(REGISTRY_SKILL_FILE, REGISTRY_LESSONS_FILE));
    let lessonCount = 0;
    let lessonsHash: string | undefined;
    if (lessonsEntry) {
      const lessonText = await read(lessonsEntry);
      if (lessonText) {
        lessonCount = countLessons(lessonText);
        lessonsHash = shortDigest(contentDigest(lessonText));
        lessons += lessonCount;
      }
    }

    await mirror(entry.path, warnings, tally, () => upsertRegistrySkill(registry.orgId, registry.id, parsed.value));
    seen.skills.push(entry.path);
    catalogSkills.push({
      name: parsed.value.name,
      version: parsed.value.version,
      category: parsed.value.category,
      path: entry.path,
      contentHash: shortDigest(parsed.value.hash),
      lessons: lessonCount,
      ...(lessonsEntry ? { lessonsPath: lessonsEntry.path, lessonsHash } : {}),
    });
  }

  // ── practices/<slug>/PRACTICE.md (starter/** travels with the PR, not the mirror row) ──
  for (const entry of picked.practices) {
    const text = await read(entry);
    if (text === null) continue;
    const parsed = parseRegistryPractice(entry.path, text);
    if (!parsed.ok) {
      warnings.push(parsed.reason);
      continue;
    }
    warnings.push(...parsed.warnings);
    await mirror(entry.path, warnings, tally, () => upsertRegistryPractice(registry.orgId, registry.id, parsed.value));
    seen.practices.push(entry.path);
    const dir = entry.path.slice(0, entry.path.lastIndexOf("/"));
    catalogPractices.push({
      id: parsed.value.practiceId || parsed.value.slug,
      dimension: parsed.value.dimension,
      path: entry.path,
      contentHash: shortDigest(parsed.value.hash),
      starter: picked.blobs.filter((b) => b.path.startsWith(`${dir}/starter/`)).map((b) => b.path),
    });
  }

  // ── memory/<kind>/<slug>.md ──
  for (const entry of picked.memory) {
    const text = await read(entry);
    if (text === null) continue;
    const parsed = parseRegistryMemory(entry.path, text);
    if (!parsed.ok) {
      warnings.push(parsed.reason);
      continue;
    }
    warnings.push(...parsed.warnings);
    await mirror(entry.path, warnings, tally, () => upsertRegistryMemory(registry.orgId, registry.id, parsed.value));
    seen.memory.push(entry.path);
    catalogMemory.push({
      kind: parsed.value.kind,
      slug: entry.path.split("/").pop()!.replace(/\.md$/, ""),
      path: entry.path,
      contentHash: shortDigest(parsed.value.hash),
      confidence: parsed.value.confidence,
      namespace: parsed.value.namespace,
      source: parsed.value.source,
    });
  }

  if (tally.notPersisted) {
    warnings.push(`${tally.notPersisted} artifacts were read and parsed but not mirrored — persistence is off.`);
  }
  const zero = { skills: 0, practices: 0, memory: 0 };
  const archived = await archiveVanishedRegistryRows(registry.id, seen).catch(() => zero);

  const counts = { skills: seen.skills.length, practices: seen.practices.length, memory: seen.memory.length, lessons };
  const catalog = buildCatalog({
    fullName: registry.fullName,
    defaultBranch: registry.defaultBranch,
    canonical: declaration.canonical,
    mode: modeToYaml(declaration.mode),
    telemetry: declaration.telemetry,
    skills: catalogSkills,
    practices: catalogPractices,
    memory: catalogMemory,
    lessons,
    generatedAt: new Date().toISOString(),
    generatedBy: "ascent",
  });

  await recordIndexResult(registry.id, {
    headSha: tree.headSha,
    counts,
    warnings,
    catalogSha: picked.byPath.get(REGISTRY_CATALOG_PATH)?.sha ?? null,
  }).catch(() => {});

  return { kind: "ok", headSha: tree.headSha, counts, warnings, archived, declaration, catalog };
}
