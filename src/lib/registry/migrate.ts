// Export what ascent currently HOSTS into the registry layout, as one draft PR per artifact type.
//
// One PR per type (skills, then practices, then memory) is a deliberate product decision, not a
// technical one: a single PR moving an org's whole knowledge base is unreviewable, and this content
// only becomes real when a human reads it. Each PR is cut on its own stable branch, so re-running a
// type updates that PR rather than opening a second one.
//
// Nothing is deleted on the ascent side by opening a PR. A row flips to `origin = "registry"` only
// when the indexer sees the file — i.e. after the merge. Until then both surfaces read consistently.

import { AppApiError } from "@/lib/github/app";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import { ensureFrontmatter, slugifySkillName } from "@/lib/org/skill-frontmatter";
import { parseFullName, REGISTRY_DIRS, REGISTRY_PRACTICE_FILE, REGISTRY_SKILL_FILE, type RegistryFile } from "./layout";

export type MigrationType = "skills" | "practices" | "memory";

export const MIGRATION_TYPES: readonly MigrationType[] = ["skills", "practices", "memory"];

export const migrationBranch = (type: MigrationType) => `ascent/registry-migrate-${type}`;

export interface HostedSkill {
  name: string;
  description: string;
  category: string;
  content: string;
  tags?: string[];
}

export interface HostedPractice {
  slug: string;
  practiceId: string;
  dimension: string;
  title: string;
  appliesWhen: string;
  content: string;
}

export interface HostedMemory {
  kind: string;
  namespace: string | null;
  confidence: number;
  source: string | null;
  content: string;
}

export interface HostedArtifacts {
  skills: HostedSkill[];
  practices: HostedPractice[];
  memory: HostedMemory[];
}

const yamlString = (v: string) => JSON.stringify(v);

/** First `# Heading`, else the first prose line, else `fallback` — the note's filename stem. */
function titleOf(content: string, fallback: string): string {
  const heading = /^#{1,3}\s+(.+)$/m.exec(content)?.[1];
  if (heading) return heading.trim();
  const line = content.split("\n").find((l) => l.trim() && !l.trim().startsWith("---"));
  return (line ?? fallback).trim().slice(0, 80);
}

/** Make `slug` unique within `taken`, appending -2, -3, … Registry paths are the row identity. */
function uniqueSlug(slug: string, taken: Set<string>): string {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/**
 * The files one migration PR commits. PURE — same rows in, same bytes out, so a re-run is a no-op
 * diff rather than churn. An empty input yields an empty array and the caller must NOT open a PR.
 */
export function buildMigrationFiles(type: MigrationType, hosted: HostedArtifacts): RegistryFile[] {
  const taken = new Set<string>();
  if (type === "skills") {
    return hosted.skills.map((s, i) => {
      const name = uniqueSlug(slugifySkillName(s.name) || `skill-${i + 1}`, taken);
      return {
        path: `${REGISTRY_DIRS.skills}/${name}/${REGISTRY_SKILL_FILE}`,
        body: ensureFrontmatter(s.content, {
          name,
          description: s.description,
          category: s.category,
          tags: s.tags ?? [],
        }),
      };
    });
  }

  if (type === "practices") {
    return hosted.practices.map((p, i) => {
      const slug = uniqueSlug(slugifySkillName(p.slug || p.practiceId) || `practice-${i + 1}`, taken);
      const fm = [
        "---",
        `id: ${p.practiceId || slug}`,
        ...(p.dimension ? [`dimension: ${p.dimension}`] : []),
        ...(p.title ? [`title: ${yamlString(p.title)}`] : []),
        ...(p.appliesWhen ? [`applies-when: ${yamlString(p.appliesWhen)}`] : []),
        "---",
        "",
      ].join("\n");
      return { path: `${REGISTRY_DIRS.practices}/${slug}/${REGISTRY_PRACTICE_FILE}`, body: fm + p.content.trimStart() };
    });
  }

  return hosted.memory.map((m, i) => {
    const kind = /^[a-z]+$/.test(m.kind) ? m.kind : "semantic";
    const slug = uniqueSlug(slugifySkillName(titleOf(m.content, `note-${i + 1}`)) || `note-${i + 1}`, taken);
    const fm = [
      "---",
      `kind: ${kind}`,
      `confidence: ${m.confidence}`,
      ...(m.namespace ? [`namespace: ${m.namespace}`] : []),
      ...(m.source ? [`source: ${yamlString(m.source)}`] : []),
      "---",
      "",
    ].join("\n");
    return { path: `${REGISTRY_DIRS.memory}/${kind}/${slug}.md`, body: fm + m.content.trimStart() };
  });
}

export type MigrationPrResult =
  | { kind: "ok"; url: string; number: number; branch: string; committed: string[]; skipped: string[]; reused: boolean }
  | { kind: "empty"; message: string }
  | { kind: "bad-repo"; message: string };

export interface OpenMigrationPrInput {
  token: string;
  slug: string;
  fullName: string;
  type: MigrationType;
  files: RegistryFile[];
  base?: string;
}

const TITLES: Record<MigrationType, string> = {
  skills: "Move the org's skills into the registry",
  practices: "Move the org's practice shapes into the registry",
  memory: "Move the org's memory notes into the registry",
};

/**
 * Open (or update) the migration PR for one artifact type. A path that already exists on the base
 * branch is SKIPPED, never overwritten — the registry's copy always wins over ascent's export, which
 * makes re-running a partially-merged migration safe.
 */
export async function openMigrationPr(input: OpenMigrationPrInput): Promise<MigrationPrResult> {
  const ref = parseFullName(input.fullName);
  if (!ref) return { kind: "bad-repo", message: `"${input.fullName}" is not a valid owner/repo name.` };
  if (input.files.length === 0) {
    return { kind: "empty", message: `No hosted ${input.type} to migrate — nothing was opened.` };
  }

  const branch = migrationBranch(input.type);
  const title = TITLES[input.type];
  const body = `Exports the ${input.type} currently hosted in Ascent for **${input.slug}** into this registry's layout.

Review them as content, not as a data migration: edit, split, or drop anything that should not be
shared. Ascent keeps serving the hosted copies until this merges; after the merge its indexer picks
these files up and the rows switch to registry-backed.

Files already present in this repository are left untouched.

_Opened by Ascent._`;

  const committed: string[] = [];
  const skipped: string[] = [];
  let pr: OpenPrResult | null = null;

  for (const f of input.files) {
    try {
      pr = await openDraftPr({
        token: input.token,
        owner: ref.owner,
        repo: ref.repo,
        branch,
        base: input.base,
        path: f.path,
        content: f.body,
        commitMessage: `chore(registry): migrate ${f.path} (via Ascent)`,
        prTitle: title,
        prBody: body,
      });
      committed.push(f.path);
    } catch (err) {
      if (err instanceof AppApiError && err.status === 409) {
        skipped.push(f.path);
        continue;
      }
      throw err;
    }
  }

  if (!pr) return { kind: "empty", message: `Every ${input.type} file already exists in the registry.` };
  return { kind: "ok", url: pr.url, number: pr.number, branch: pr.branch, reused: pr.reused, committed, skipped };
}
