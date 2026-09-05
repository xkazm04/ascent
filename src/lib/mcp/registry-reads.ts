// The org-registry READ tools: what this organization's own standard says (moonshot #17). The two
// write tools that report back live in `registry-writes.ts`, for the reason stated there.
//
// WHY THESE LIVE HERE AND NOT IN `handlers.ts`. The original handlers are projections of the FLEET's
// computed standing — scores, gate verdicts, recommendations, all of it ascent's own arithmetic. The
// tools below project a different thing: the org's CURATED corpus — its skills, the registry subjects
// that govern its work, the lessons it has recorded. Keeping them in their own module is what stops
// `handlers.ts` from becoming the place every future tool is appended to.
//
// EVERY RESULT ANSWERS ABSENCE IN WORDS. An org with no registry mapped, a skill name that does not
// exist, a repo that has never been scanned: each is a sentence explaining what is missing and why,
// never an empty list. An agent handed `[]` reads "nothing to worry about" and proceeds; that is the
// exact failure this product exists to prevent.

import { getOrgId, getOrgRollup, listOrgSkills, type SkillRow } from "@/lib/db";
import { listOrgKnowledgeSubjects } from "@/lib/db/org-registry-subjects";
import { listSkillLessons } from "@/lib/db/org-skill-lessons";
import { rankSkills, weakDimensionsFor } from "@/lib/mcp/skill-match";
import type { ToolResult } from "@/lib/mcp/handlers";

/** The argument bag a tool call arrives with. Untyped by the protocol; validated per handler. */
export type Args = Record<string, unknown>;

export const str = (a: Args, k: string): string | null =>
  typeof a[k] === "string" ? (a[k] as string).trim() : null;

/** A tool-execution error — actionable feedback the model can self-correct from (`isError: true`). */
export const fail = (message: string): ToolResult => ({
  structuredContent: { error: message },
  text: message,
  isError: true,
});

/** Exact-name lookup over the org's skills. `null` = persistence off (a different fact from "absent"). */
export async function findSkillByName(org: string, name: string): Promise<SkillRow | null | undefined> {
  const rows = await listOrgSkills(org, { search: name });
  if (rows === null) return null;
  return rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
}

/**
 * The dimension basis a `find_skills` answer ranked against — or an explicit NULL and a sentence.
 *
 * `null` is never `[]`. An unscanned repo, a repo not in this fleet, and a repo whose latest scan is
 * healthy everywhere are three different situations, and a zeroed dimension list would render the
 * first two as the third. The agent is told which one it is and can act accordingly.
 */
export interface DimensionBasis {
  repo: string;
  weakDims: string[];
  scannedAt: string;
}

async function dimensionBasisFor(
  org: string,
  repo: string | null,
): Promise<{ basis: DimensionBasis | null; note: string }> {
  if (!repo) {
    return {
      basis: null,
      note: "No repository was named, so ranking used the task description alone. Pass `repo` to also weight skills toward the dimensions that repository is weakest in.",
    };
  }
  const rollup = await getOrgRollup(org);
  const row = rollup?.repos.find((r) => r.fullName.toLowerCase() === repo.toLowerCase());
  if (!row) {
    return { basis: null, note: `"${repo}" is not in this organization's fleet, so ranking used the task description alone.` };
  }
  if (!row.latest) {
    return {
      basis: null,
      note: `"${repo}" has never been scanned, so this organization does not know which dimensions it is weak in. Ranking used the task description alone — that is an absence of evidence, not a clean bill of health.`,
    };
  }
  const weakDims = weakDimensionsFor(row.latest.overall, row.latest.dims);
  return {
    basis: { repo: row.fullName, weakDims, scannedAt: row.latest.scannedAt },
    note: weakDims.length
      ? `Ranking also weighted skills toward ${weakDims.join(", ")} — the dimensions ${row.fullName} scores below its own level band on.`
      : `${row.fullName} is not below its own level band on any dimension, so ranking used the task description alone.`,
  };
}

/** `find_skills` — which of this org's own skills bear on the task the agent is about to do. */
export async function findSkills(org: string, args: Args): Promise<ToolResult> {
  const task = str(args, "task");
  if (!task) return fail("Provide `task` — a sentence describing what you are about to do.");
  const rows = await listOrgSkills(org, {});
  if (rows === null) return fail("This installation has no persistence configured, so it has no skills library to search.");
  if (rows.length === 0) {
    return fail(
      "This organization's skills library is empty, so there is no house guidance to match. That is an absence, not permission to invent one.",
    );
  }

  const repo = str(args, "repo");
  const { basis, note } = await dimensionBasisFor(org, repo);
  const limit = typeof args.limit === "number" ? args.limit : 5;
  const ranked = rankSkills(task, rows, { weakDims: basis ? basis.weakDims : null, limit });

  if (ranked.length === 0) {
    return {
      structuredContent: {
        org,
        task,
        count: 0,
        skills: [],
        dimensionBasis: basis,
        dimensionBasisNote: note,
        note: `None of this organization's ${rows.length} skills matched that task. Nothing here governs it — which is not the same as this organization having no opinion; check get_governing_subject for the standard that does.`,
      },
    };
  }

  return {
    structuredContent: {
      org,
      task,
      count: ranked.length,
      // `null` when unscanned or absent, WITH the sentence beside it. Never a zeroed dimension list.
      dimensionBasis: basis,
      dimensionBasisNote: note,
      skills: ranked.map((r) => ({
        name: r.name,
        description: r.description,
        category: r.category,
        tags: r.tags,
        why: r.why,
        adoptionCount: r.adoptionCount,
        registryPath: r.registryPath,
        registryVersion: r.registryVersion,
      })),
      next: "Call get_skill with a name to read the skill itself, and report_skill_invoke once you have run it.",
    },
  };
}

/** `get_skill` — one skill's body, exactly as this organization publishes it. */
export async function getSkill(org: string, args: Args): Promise<ToolResult> {
  const name = str(args, "name");
  if (!name) return fail("Provide `name` — the skill's name, as find_skills returned it.");
  const skill = await findSkillByName(org, name);
  if (skill === null) return fail("This installation has no persistence configured, so it has no skills library to read.");
  if (!skill) {
    return fail(`"${name}" is not a skill in this organization's library. Call find_skills to see what it publishes.`);
  }
  return {
    structuredContent: {
      name: skill.name,
      description: skill.description,
      category: skill.category,
      tags: skill.tags,
      content: skill.content,
      // WHERE THE TRUTH LIVES. A registry-origin skill is a mirror of a file in a repo the customer
      // owns and is changed by pull request; a hosted one lives in ascent's own table. An agent
      // proposing an edit needs to know which, or it will propose it in the wrong place.
      origin: skill.origin,
      registryPath: skill.registryPath,
      registryVersion: skill.registryVersion,
      contentHash: skill.contentHash,
      adoptionCount: skill.adoptionCount,
      next: "Call report_skill_invoke after you run it, so this organization can tell a used skill from a dormant one.",
    },
  };
}

/** `get_skill_lessons` — what has actually been learned running a skill (#36's store). */
export async function getSkillLessons(org: string, args: Args): Promise<ToolResult> {
  const name = str(args, "name");
  if (!name) return fail("Provide `name` — the skill whose lessons you want.");
  const orgId = await getOrgId(org);
  if (!orgId) return fail(`No data for organization "${org}".`);

  const lessons = await listSkillLessons(orgId, name);
  if (lessons.length === 0) {
    return {
      structuredContent: {
        skill: name,
        count: 0,
        lessons: [],
        note: `No lessons are recorded against "${name}". Lessons come from this organization's registry (skills/<name>/LESSONS.md); an empty result means none have been written, not that the skill has always gone smoothly.`,
      },
    };
  }
  return {
    structuredContent: {
      skill: name,
      count: lessons.length,
      lessons: lessons.map((l) => ({
        versionUsed: l.versionUsed || null,
        // Null rather than a substituted "today": a lesson whose heading carried no readable date
        // has an unknown date, and dating it now would make an old lesson look fresh.
        learnedOn: l.learnedOn,
        project: l.project || null,
        heading: l.headingRaw,
        body: l.body,
        registryPath: l.registryPath,
      })),
      basis:
        "These are written by people and agents in this organization after running the skill. They are experience reports, not the skill's specification — get_skill is the specification.",
    },
  };
}

/**
 * `get_governing_subject` — the registry subject whose `use_when` governs this path or topic.
 *
 * RESOLVED THROUGH THE MIRRORED `file` COLUMN, never by building a path from a slug. That is the
 * registry access contract: a subject's location is data the index publishes, and a constructed path
 * is a guess that silently 404s the day the registry reorganizes.
 */
export async function getGoverningSubject(org: string, args: Args): Promise<ToolResult> {
  const path = str(args, "path");
  const topic = str(args, "topic");
  if (!path && !topic) return fail("Provide `path` (a file you are about to change) or `topic` (what you are deciding).");

  const orgId = await getOrgId(org);
  if (!orgId) return fail(`No data for organization "${org}".`);
  const subjects = await listOrgKnowledgeSubjects(orgId);
  if (subjects.length === 0) {
    // ABSENCE-ONLY, AND EXPLICIT. "No registry is mapped" and "a registry is mapped but governs
    // nothing here" are both answered in words rather than as an empty list a model reads as consent.
    return fail(
      "No AI registry is mapped to this organization, or none of its knowledge bundles have been indexed yet, so there is no governing subject to cite. Absence of a standard is not permission to invent one — ask this organization.",
    );
  }

  const needle = `${path ?? ""} ${topic ?? ""}`.toLowerCase();
  const terms = needle.split(/[^a-z0-9/._-]+/).filter((t) => t.length > 2);
  const scored = subjects
    .map((s) => {
      // `use_when` is the subject's OWN statement of when it applies — the registry's designed
      // trigger — so it is matched first and weighted above the title.
      const useWhen = s.useWhen.join(" ").toLowerCase();
      const hits = terms.filter((t) => useWhen.includes(t)).length * 3 + terms.filter((t) => s.slug.includes(t)).length;
      return { s, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.s.slug.localeCompare(b.s.slug))
    .slice(0, 3);

  if (scored.length === 0) {
    return {
      structuredContent: {
        org,
        query: { path, topic },
        count: 0,
        subjects: [],
        note: `None of this organization's ${subjects.length} indexed registry subjects declare a use_when matching that. No subject governs it — which means you are unguided here, not unconstrained.`,
      },
    };
  }

  return {
    structuredContent: {
      org,
      query: { path, topic },
      count: scored.length,
      subjects: scored.map(({ s }) => ({
        bundle: s.bundle,
        slug: s.slug,
        title: s.slug,
        category: s.category,
        status: s.status,
        useWhen: s.useWhen,
        laws: s.laws,
        techniqueCount: s.techniqueCount,
        // The mirrored path, verbatim. Resolve it against the registry; do NOT build one from the slug.
        file: s.file,
      })),
      basis:
        "Resolved through the registry index this organization mirrored, using each subject's declared use_when. Open `file` in the registry for the governing text itself.",
    },
  };
}

