// File -> mirror-row parsers for the registry indexer.
//
// The frontmatter reader is the EXISTING one (`@/lib/org/skill-frontmatter`): it is CRLF-tolerant,
// handles block sequences, and already returns `raw` (every key as read) plus the stripped `body`.
// Reusing it means a registry file and an in-app skill are held to one grammar, not two that drift.
//
// RESILIENCE IS THE CONTRACT. Nothing here throws. Every function returns either a value or a
// `skipped` reason, and a file that parses only partially is indexed with fallbacks plus a warning.
// A registry is edited by hand in a text editor; one typo must degrade one file, never the pass.

import { createHash } from "node:crypto";
import { parseSkillFrontmatter, slugifySkillName } from "@/lib/org/skill-frontmatter";
import { normalizeSkillCategory } from "@/lib/org/skill-categories";
import type { MirrorMemoryInput, MirrorPracticeInput, MirrorSkillInput } from "@/lib/db/org-registry-mirror";

/** A parse outcome: the mirror input, plus any non-fatal complaints, or a skip with its reason. */
export type ParseOutcome<T> = { ok: true; value: T; warnings: string[] } | { ok: false; reason: string };

export const hashFile = (content: string) => createHash("sha256").update(content).digest("hex");

const splitList = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

/** `skills/pr-review/SKILL.md` -> `pr-review`. Empty when the path has no directory segment. */
export function dirSegment(path: string, depthFromEnd = 2): string {
  const parts = path.split("/");
  return parts[parts.length - depthFromEnd] ?? "";
}

/** First non-blank, non-heading line — the stand-in description for a document without frontmatter. */
function firstProse(body: string): string {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("---")) continue;
    return t.replace(/^[*_>-]+\s*/, "").slice(0, 1000);
  }
  return "";
}

/** First `# Heading`, else the slug prettified. */
function firstHeading(body: string, fallback: string): string {
  const m = /^#{1,3}\s+(.+)$/m.exec(body);
  return (m?.[1] ?? fallback).trim().slice(0, 200);
}

/** `skills/<name>/SKILL.md`. A document without frontmatter still indexes — under its directory name. */
export function parseRegistrySkill(path: string, content: string): ParseOutcome<MirrorSkillInput> {
  if (!content.trim()) return { ok: false, reason: `${path}: file is empty` };
  const fm = parseSkillFrontmatter(content);
  const warnings: string[] = [];

  const dir = dirSegment(path);
  const declared = (fm.raw.name ?? "").trim();
  const name = slugifySkillName(declared || dir);
  if (!name) return { ok: false, reason: `${path}: no usable skill name (directory or frontmatter)` };
  if (!fm.present) warnings.push(`${path}: no frontmatter block — indexed as "${name}" from its directory name`);
  else if (!fm.ok) warnings.push(`${path}: ${fm.errors[0] ?? "frontmatter did not validate"}`);

  const description = (fm.raw.description ?? "").trim() || firstProse(fm.body);
  return {
    ok: true,
    warnings,
    value: {
      path,
      hash: hashFile(content),
      name,
      description,
      category: normalizeSkillCategory(fm.raw.category ?? null),
      content: fm.present ? fm.body : content,
      version: (fm.raw.version ?? "").trim() || null,
      tags: splitList(fm.raw.tags),
    },
  };
}

// The registry's memory vocabulary (`memory/<kind>/…`, and the `memoryKinds` policy) is authored for
// humans; OrgMemory.kind is the four-value column every existing recall path filters on. Map, don't
// coerce: the ORIGINAL word is kept as a tag so nothing the author wrote is lost.
const MEMORY_KIND: Record<string, string> = {
  decision: "semantic",
  finding: "semantic",
  gotcha: "semantic",
  semantic: "semantic",
  procedure: "procedural",
  procedural: "procedural",
  howto: "procedural",
  summary: "summary",
  episodic: "episodic",
  session: "episodic",
};

/** `memory/<kind>/<slug>.md`. `kind` comes from frontmatter, else from the directory. */
export function parseRegistryMemory(path: string, content: string): ParseOutcome<MirrorMemoryInput> {
  if (!content.trim()) return { ok: false, reason: `${path}: file is empty` };
  const fm = parseSkillFrontmatter(content);
  const warnings: string[] = [];

  const body = (fm.present ? fm.body : content).trim();
  if (!body) return { ok: false, reason: `${path}: frontmatter only, no note body` };

  const declaredKind = (fm.raw.kind ?? "").trim().toLowerCase();
  const dirKind = dirSegment(path).toLowerCase();
  const rawKind = declaredKind || dirKind;
  const kind = MEMORY_KIND[rawKind];
  if (!kind) warnings.push(`${path}: unrecognized memory kind "${rawKind || "(none)"}" — indexed as semantic`);

  const rawConfidence = Number.parseFloat((fm.raw.confidence ?? "").trim());
  let confidence = 1;
  if ((fm.raw.confidence ?? "").trim()) {
    if (Number.isFinite(rawConfidence)) confidence = Math.min(1, Math.max(0, rawConfidence));
    else warnings.push(`${path}: confidence "${fm.raw.confidence}" is not a number — indexed as 1.0`);
  }

  const tags = splitList(fm.raw.tags);
  if (rawKind && rawKind !== kind) tags.unshift(rawKind);
  return {
    ok: true,
    warnings,
    value: {
      path,
      hash: hashFile(content),
      content: body,
      kind: kind ?? "semantic",
      namespace: (fm.raw.namespace ?? "").trim() || null,
      confidence,
      source: (fm.raw.source ?? "").trim() || `registry:${path}`,
      tags: tags.slice(0, 20),
    },
  };
}

const DIMENSION_RE = /^D(?:10|[1-9])$/;

/** `practices/<slug>/PRACTICE.md`. The SHAPE only — never a customer artifact body. */
export function parseRegistryPractice(path: string, content: string): ParseOutcome<MirrorPracticeInput> {
  if (!content.trim()) return { ok: false, reason: `${path}: file is empty` };
  const fm = parseSkillFrontmatter(content);
  const warnings: string[] = [];

  const slug = slugifySkillName(dirSegment(path));
  if (!slug) return { ok: false, reason: `${path}: no usable practice slug (directory name)` };
  if (!fm.present) warnings.push(`${path}: no frontmatter block — id/dimension unknown`);

  const dimension = (fm.raw.dimension ?? "").trim().toUpperCase();
  if (dimension && !DIMENSION_RE.test(dimension)) {
    warnings.push(`${path}: dimension "${dimension}" is not D1–D10 — recorded as unset`);
  }
  return {
    ok: true,
    warnings,
    value: {
      path,
      hash: hashFile(content),
      slug,
      practiceId: (fm.raw.id ?? "").trim().slice(0, 100),
      dimension: DIMENSION_RE.test(dimension) ? dimension : "",
      title: (fm.raw.title ?? "").trim() || firstHeading(fm.body, slug),
      appliesWhen: (fm.raw["applies-when"] ?? fm.raw.applieswhen ?? "").trim(),
      content: fm.present ? fm.body : content,
    },
  };
}
