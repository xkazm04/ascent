// Graded artifact ladders for the App Readiness Passport (0.2.0). `memory` and `skills` were booleans in
// 0.1.0 — "present" told you nothing about whether the thing is decision MEMORY or a stray note file. The
// ladder is the sibling pattern proven in Personas: none → adhoc → curated → governed.
//
//   none      the artifact is absent
//   adhoc     present but unstructured — a single flat file / one lone entry; no library shape
//   curated   structured per-fact entries or a maintained library (>=2 entries under the canonical dir,
//             or an index plus entries)
//   governed  curated PLUS observable process: supersede/replaces links between entries, a registry, a
//             policy/schema file, or a CI job that checks them
//
// HONESTY RULE (the same one that caps ci/security at "present" without branch protection): only file
// CONTENT we actually fetched can prove the `governed` rung. A snapshot that lists a memory dir but whose
// files weren't fetched caps at `curated` — we never claim a rung the evidence can't support. When two
// rungs are arguable, score the LOWER one.
//
// Pure + deterministic over the snapshot probes; no IO, no clock.

import type { ArtifactGrade } from "@/lib/types";

/** The subset of the builder's snapshot probes these ladders need (structural, so passport.ts's private
 *  `probes()` satisfies it without exporting its shape). */
export interface GradeProbes {
  lowerPaths: string[];
  get: (p: string) => string | undefined;
  workflowText: string;
  scripts: Record<string, string>;
}

// ── memory ────────────────────────────────────────────────────────────────────────────────────────
/** Canonical agent-memory homes: `.ai/memory[.md]` and `.claude/memory[.md]` (dir or single file). */
const MEMORY_PATH = /^\.(ai|claude)\/memory(\/|\.md$|$)/;
/** An entry file INSIDE a memory directory (excludes the dir node itself). */
const MEMORY_ENTRY = /^\.(ai|claude)\/memory\/.+\.(md|markdown|json|ya?ml)$/;
const MEMORY_INDEX = /^\.(ai|claude)\/memory\/(index|memory|readme)\.(md|markdown|json|ya?ml)$/;
/** Process evidence inside a memory entry: an explicit lineage link between facts. */
const SUPERSEDE = /(^|\n)[\s>*-]*(supersedes?|superseded[-_ ]?by|replaces|replaced[-_ ]?by)\s*:/i;
/** A CI job that actually references the memory tree — not the word "memory" in an unrelated log line. */
const MEMORY_IN_CI = /\.(ai|claude)\/memory/;

export function gradeMemory(p: GradeProbes): ArtifactGrade {
  const paths = p.lowerPaths.filter((x) => MEMORY_PATH.test(x));
  if (paths.length === 0) return "none";

  const entries = paths.filter((x) => MEMORY_ENTRY.test(x) && !MEMORY_INDEX.test(x));
  const hasIndex = paths.some((x) => MEMORY_INDEX.test(x));
  // curated = a real library: several per-fact entries, or an index that curates at least one entry.
  const curated = entries.length >= 2 || (hasIndex && entries.length >= 1);
  if (!curated) return "adhoc";

  // governed = curated + observable process. Content evidence only counts for files we actually fetched.
  const lineage = [...entries, ...paths.filter((x) => MEMORY_INDEX.test(x))].some((x) => {
    const body = p.get(x);
    return body !== undefined && SUPERSEDE.test(body);
  });
  const policy = paths.some((x) => /\/(schema|policy|conventions)\.(md|json|ya?ml)$/.test(x));
  const ciChecks = MEMORY_IN_CI.test(p.workflowText);
  return lineage || policy || ciChecks ? "governed" : "curated";
}

// ── skills ────────────────────────────────────────────────────────────────────────────────────────
/** Canonical skill homes: `.claude/skills/**` and a top-level `skills/**`. */
const SKILL_PATH = /^(\.claude\/skills|skills)\//;
/** A skill's own definition file, which is what makes it a first-class skill rather than a loose note. */
const SKILL_DEF = /^(?:\.claude\/skills|skills)\/([^/]+)\/(?:.*\/)?(skill|readme)\.md$/;
const SKILL_REGISTRY = /^(\.claude\/skills|skills)\/(index|registry|readme)\.(md|json|ya?ml)$/;
/** A CI job that actually references the skills tree. */
const SKILLS_IN_CI = /(\.claude\/skills|(^|[\s"'`/])skills\/)/m;

export function gradeSkills(p: GradeProbes): ArtifactGrade {
  const paths = p.lowerPaths.filter((x) => SKILL_PATH.test(x));
  if (paths.length === 0) return "none";

  const named = new Set<string>();
  for (const x of paths) {
    const m = SKILL_DEF.exec(x);
    if (m?.[1]) named.add(m[1]);
  }
  // curated = a maintained LIBRARY: >=2 distinct skills that each carry their own definition file.
  if (named.size < 2) return "adhoc";

  // governed = curated + observable process: a registry at the skills root, a CI job that checks skills,
  // or a package script that lints/validates them.
  const registry = paths.some((x) => SKILL_REGISTRY.test(x));
  const ciChecks = SKILLS_IN_CI.test(p.workflowText);
  const scripted = Object.entries(p.scripts).some(([k, v]) => /skill/i.test(k) || /skill/i.test(v ?? ""));
  return registry || ciChecks || scripted ? "governed" : "curated";
}

/** Ordinal rank of a grade — for sorting/rollups (and so a reader can compare two repos numerically). */
export const GRADE_RANK: Record<ArtifactGrade, number> = { none: 0, adhoc: 1, curated: 2, governed: 3 };
