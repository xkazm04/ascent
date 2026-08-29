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
import { purgeUsageSamples, recordUsageSamples } from "@/lib/db/org-skill-usage-samples";
import { replaceRegistrySubjects } from "@/lib/db/org-registry-subjects";
import { recordRegistrySignals } from "@/lib/db/org-registry-signals";
import { purgeSkillLessons, replaceSkillLessons } from "@/lib/db/org-skill-lessons";
import { upsertRegistryMemory, upsertRegistryPractice, upsertRegistrySkill } from "@/lib/db/org-registry-mirror";
import { buildCatalog, shortDigest, type RegistryCatalog } from "./catalog";
import { REGISTRY_CATALOG_PATH, REGISTRY_LESSONS_FILE, REGISTRY_SKILL_FILE, REGISTRY_SPINE_PATH } from "./layout";
import { cappedReader, countLessons, selectArtifacts, type RegistrySource } from "./index-walk";
import { contentDigest, parseRegistryMemory, parseRegistryPractice, parseRegistrySkill } from "./parse";
import { modeToYaml, parseRegistryYaml, type RegistryDeclaration } from "./policy";
import { aggregateUsage, type RegistryUsage } from "./usage-samples";
import { readBundleSubjects, type KnowledgeSubject } from "./subjects";
import { lessonWarning, splitLessonEntries } from "./lessons";
import { aggregateSignals, type SignalRow } from "./signals";
import type { RegistryTree } from "./read";

export type { RegistrySource } from "./index-walk";
export { githubSource } from "./index-walk";
// Re-exported so every existing caller of `aggregateUsage`/`RegistryUsage` keeps its import path:
// the function moved to ./usage-samples (beside the type it produces) to keep THIS file orchestration.
export { aggregateUsage } from "./usage-samples";
export type { RegistryUsage } from "./usage-samples";

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
  /**
   * The registry's `usage/` lane, aggregated: how often the fleet reaches for
   * these skills and how many installations reported it.
   *
   * Ascent does not COUNT invocations — the installations that run skills do,
   * locally, and contribute an aggregate. This reads what they published. Two
   * writers for one number is the failure the per-contributor files prevent, so
   * ascent stays a reader here.
   */
  usage?: RegistryUsage;
  /**
   * The `knowledge/` lane: one row per Reference Knowledge Bundle.
   *
   * Read from each bundle's GENERATED index, never by walking its markdown —
   * that is what the index is for, and walking ~1,000 documents to recount what
   * one file already states would be both expensive and a second authority.
   */
  bundles?: RegistryBundle[];
  /**
   * The `knowledge/` lane read one level deeper than `bundles`: one entry per SUBJECT (#18).
   * `bundles` says a domain has 151 subjects; this says which, and what governs them.
   */
  subjects?: KnowledgeSubject[];
  /**
   * The `signals/` lane: what contributors learned about the corpus — consults, deviations and
   * citation health per subject. Empty on a registry nobody contributes to, which is a different
   * fact from a corpus nobody consults, and every reader of this says so.
   */
  signals?: { rows: SignalRow[]; contributors: number };
}

/** One Reference Knowledge Bundle, as its generated index states it. */
export interface RegistryBundle {
  /** Directory name under `knowledge/`. */
  name: string;
  subjects: number;
  techniques: number;
  applications: number;
  /** Cross-cutting laws the bundle's techniques cite. */
  laws: number;
  /** Category ids the bundle declares, in its own order. */
  categories: string[];
  /** `written/total` — how many techniques carry a consult trigger. */
  useWhenCoverage: string | null;
}

/**
 * Read the bundle indexes. Tolerant like every other read here: a malformed
 * index degrades ITSELF into a warning and the other bundles still land.
 *
 * Counts are taken from `meta` verbatim rather than recomputed. The bundle's own
 * generator owns them; recomputing here would make ascent a second authority for
 * a number it does not produce, and the two would drift the first time either
 * side changed what it counts.
 */
export function readBundles(
  files: { path: string; text: string | null }[],
  warnings: string[],
): RegistryBundle[] {
  const out: RegistryBundle[] = [];
  for (const { path, text } of files) {
    if (text === null) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      warnings.push(`${path}: not valid JSON — bundle not indexed`);
      continue;
    }
    const meta = (doc as { meta?: Record<string, unknown> })?.meta;
    if (!meta || typeof meta !== "object") {
      warnings.push(`${path}: no meta block — bundle not indexed`);
      continue;
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0);
    const name = typeof meta.bundle === "string" && meta.bundle ? meta.bundle : path.split("/")[1]!;
    out.push({
      name,
      subjects: num(meta.subjects),
      techniques: num(meta.techniques),
      applications: num(meta.applications),
      laws: num(meta.laws),
      categories: Array.isArray(meta.categories) ? meta.categories.filter((c) => typeof c === "string") : [],
      useWhenCoverage: typeof meta.use_when_coverage === "string" ? meta.use_when_coverage : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
  /** Every `LESSONS.md` this pass actually read — the purge set for vanished lesson rows (#36). */
  const seenLessonPaths: string[] = [];
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
        // #36 — the ROWS behind that number. `splitLessonEntries` cuts on the SAME regex, so the
        // ledger and `counts.lessons` are equal by construction rather than by agreement.
        const lessonEntries = splitLessonEntries(lessonText);
        const warn = lessonWarning(lessonsEntry.path, lessonEntries);
        if (warn) warnings.push(warn);
        seenLessonPaths.push(lessonsEntry.path);
        await mirror(lessonsEntry.path, warnings, tally, async () => {
          await replaceSkillLessons(registry.id, registry.orgId, parsed.value.name, lessonsEntry.path, lessonEntries);
          return lessonsEntry.path;
        });
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

  // The catalog as committed, read so `buildCatalog` can carry forward the keys
  // it does not own. Tolerant: an unreadable or malformed catalog means "carry
  // nothing", never a failed pass — but it IS reported, because silently
  // dropping another producer's `bundles` array is the exact outcome this read
  // exists to prevent.
  let priorCatalog: RegistryCatalog | null = null;
  {
    const entry = picked.byPath.get(REGISTRY_CATALOG_PATH);
    if (entry) {
      const text = await read(entry);
      if (text !== null) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            priorCatalog = parsed as RegistryCatalog;
          } else {
            warnings.push(`${REGISTRY_CATALOG_PATH}: not an object — foreign keys not carried forward`);
          }
        } catch {
          warnings.push(`${REGISTRY_CATALOG_PATH}: not valid JSON — foreign keys not carried forward`);
        }
      }
    }
  }

  // ── knowledge/<domain>/index.json ──
  // ONE read feeds two readers: `readBundles` takes the `meta` counts, `readBundleSubjects` takes
  // the subject map. Fetching the same file twice for two shapes of the same document would be a
  // second request per bundle for no new information.
  const bundleFiles = await Promise.all(picked.bundles.map(async (e) => ({ path: e.path, text: await read(e) })));
  const bundles = readBundles(bundleFiles, warnings);
  const subjects = readBundleSubjects(bundleFiles, warnings);

  // ── signals/<contributor>.json ──
  const signals = aggregateSignals(
    await Promise.all(picked.signals.map(async (e) => ({ path: e.path, text: await read(e) }))),
    warnings,
  );

  // ── usage/<contributor>.json ──
  const usage = aggregateUsage(
    await Promise.all(picked.usage.map(async (e) => ({ path: e.path, text: await read(e) }))),
    warnings,
  );

  const counts = { skills: seen.skills.length, practices: seen.practices.length, memory: seen.memory.length, lessons };
  const catalog = buildCatalog({
    // Carry forward the keys this builder does not own — `bundles` from the
    // knowledge lane, and anything a future producer adds. Without this, a
    // catalog write-back would silently delete another producer's work.
    previous: priorCatalog,
    fullName: registry.fullName,
    defaultBranch: registry.defaultBranch,
    canonical: declaration.canonical,
    mode: modeToYaml(declaration.mode),
    telemetry: declaration.telemetry,
    // `invokes30d` is DERIVED from the usage lane, never counted here. A skill
    // nobody reported reads 0, which is true: no witness, not "unused".
    skills: catalogSkills.map((s) => ({ ...s, invokes30d: usage.bySkill[s.name] ?? 0 })),
    practices: catalogPractices,
    memory: catalogMemory,
    lessons,
    generatedAt: new Date().toISOString(),
    generatedBy: "ascent",
  });

  // ── #36: purge lesson rows whose LESSONS.md vanished ─────────────────────────────────────────
  // Same truncated-tree guard as every other purge here: "not in this pass" is evidence of deletion
  // only when the pass saw the whole tree.
  if (!tree.truncated) {
    try {
      await purgeSkillLessons(registry.id, seenLessonPaths);
    } catch (err) {
      warnings.push(`LESSONS.md: stale rows not purged (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // ── #18: persist the knowledge subjects and the signals lane ─────────────────────────────────
  // Skipped wholesale on a truncated tree, for the same reason as the usage samples below: both
  // writers treat "absent from this pass" as "gone", and a truncated tree is exactly the case where
  // the pass's own inventory is not evidence of absence.
  if (!tree.truncated) {
    try {
      await replaceRegistrySubjects(registry.id, registry.orgId, subjects);
    } catch (err) {
      warnings.push(`knowledge/: subjects not persisted (${err instanceof Error ? err.message : String(err)})`);
    }
    try {
      await recordRegistrySignals(registry.id, registry.orgId, signals.rows);
    } catch (err) {
      warnings.push(`signals/: not persisted (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // ── #19: persist the usage lane per (contributor, skill) ─────────────────────────────────────
  // Skipped WHOLESALE on a truncated tree. `purgeUsageSamples` treats "not in this pass" as "gone",
  // and a truncated tree is precisely the case where the pass's own contributor list is unreliable —
  // acting on it would delete a live installation's counts because GitHub cut the listing short.
  if (!tree.truncated) {
    try {
      await recordUsageSamples(registry.id, registry.orgId, usage.samples);
      await purgeUsageSamples(registry.id, usage.contributorNames);
    } catch (err) {
      warnings.push(`usage/: samples not persisted (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  await recordIndexResult(registry.id, {
    headSha: tree.headSha,
    counts,
    warnings,
    catalogSha: picked.byPath.get(REGISTRY_CATALOG_PATH)?.sha ?? null,
    usage: { invokes30d: usage.invokes30d, contributors: usage.contributors },
    bundles,
    // Omitted rather than zeroed on a truncated tree, by the same rule the usage counts follow:
    // "not measured this pass" must never overwrite a good reading with an empty one.
    ...(tree.truncated ? {} : { subjectCount: subjects.length, signalContributors: signals.contributors }),
  }).catch(() => {});

  return {
    kind: "ok",
    headSha: tree.headSha,
    counts,
    warnings,
    archived,
    declaration,
    catalog,
    usage,
    bundles,
    subjects,
    signals,
  };
}
