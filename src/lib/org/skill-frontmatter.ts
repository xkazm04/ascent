// The Org Skills Library's frontmatter CONTRACT — the shared shape a SKILL.md must declare so an agent
// (Claude Code, a CI sync, the library UI) can decide *when* to use a skill without reading the body.
//
// Deliberately NOT a YAML dependency: the contract is a handful of flat scalars (`name`, `description`,
// `category`, `tags`), so a small line parser is both sufficient and safer than accepting arbitrary YAML
// from a user-authored document. Anything richer is intentionally out of contract.
//
// Three entry points:
//   - parseSkillFrontmatter(content) — read + validate a document's block ({ ok, data, errors }).
//   - ensureFrontmatter(content, defaults) — inject a block when missing, repair the invalid fields when
//     present (the write/promotion path).
//   - effectiveSkillFrontmatter(content, defaults) — READ-time backfill: what a legacy row (stored before
//     the contract existed) effectively declares, derived from its DB columns. Never rewrites storage.
//
// Pure + dependency-free (only the category enum), so it is client-safe and unit-testable.

import {
  SKILL_CATEGORIES,
  isSkillCategory,
  type SkillCategory,
} from "@/lib/org/skill-categories";

/** The validated contract. `category` is optional in the document; null when undeclared. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  category: SkillCategory | null;
  tags: string[];
}

export interface ParsedSkillFrontmatter {
  /** True only when a block was present AND every field validates. */
  ok: boolean;
  /** The validated contract, or null when the block is missing/invalid. */
  data: SkillFrontmatter | null;
  /** Actionable, one-per-problem messages (safe to surface verbatim in a 400). */
  errors: string[];
  /** A `---` block was found (even if its contents are invalid) — distinguishes "missing" from "broken". */
  present: boolean;
  /** The document with the block removed (LF-normalized), i.e. the markdown body. */
  body: string;
  /** Raw key -> value as read, before validation. The repair path reads this. */
  raw: Record<string, string>;
}

/** Kebab-case slug: lowercase alphanumerics joined by single hyphens. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 100;
const MAX_DESCRIPTION = 1000;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;

const VALID_CATEGORIES = SKILL_CATEGORIES.join(", ");

/** Coerce any human name ("PR Review Checklist") into the contract's kebab-case slug. */
export function slugifySkillName(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/g, "");
}

/** Case/format-insensitive normalization into the CLOSED category set. Null when unrecognized. */
export function normalizeFrontmatterCategory(input: string): SkillCategory | null {
  const v = input.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return isSkillCategory(v) ? v : null;
}

/** Strip one layer of matching quotes from a scalar value. */
function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** `a, b` | `[a, b]` | a block list accumulated by the line parser -> a bounded string[]. */
function parseTagList(raw: string): string[] {
  let s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  return s
    .split(",")
    .map((t) => unquote(t))
    .filter(Boolean)
    .map((t) => t.slice(0, MAX_TAG_LEN))
    .slice(0, MAX_TAGS);
}

const KEY_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;

/**
 * Read + validate a SKILL.md's frontmatter block. CRLF-tolerant (a document authored on Windows or
 * round-tripped through a textarea must not fail the contract). Leading blank lines are tolerated;
 * anything before the opening `---` that isn't blank means there is no block.
 */
export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  if (start >= lines.length || (lines[start] ?? "").trim() !== "---") {
    return {
      ok: false,
      data: null,
      present: false,
      body: text,
      raw: {},
      errors: [
        "The document has no YAML frontmatter block. Start it with `---` on the first line, then `name:` and `description:`.",
      ],
    };
  }

  const raw: Record<string, string> = {};
  const errors: string[] = [];
  let close = -1;
  let listKey: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "---" || trimmed === "...") {
      close = i;
      break;
    }
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("- ") || trimmed === "-") {
      // A block-sequence item — only meaningful under a key that opened with an empty value.
      if (listKey) {
        const item = unquote(trimmed.replace(/^-\s*/, ""));
        raw[listKey] = raw[listKey] ? `${raw[listKey]}, ${item}` : item;
      } else {
        errors.push(`Frontmatter line ${i + 1}: a list item ("${trimmed}") has no key above it.`);
      }
      continue;
    }
    const m = KEY_RE.exec(trimmed);
    if (!m) {
      errors.push(`Frontmatter line ${i + 1}: expected \`key: value\`, got "${trimmed.slice(0, 60)}".`);
      continue;
    }
    const key = (m[1] ?? "").toLowerCase();
    const value = unquote(m[2] ?? "");
    if (value === "") {
      listKey = key; // may be a block list; an empty scalar validates as missing either way
      raw[key] = "";
    } else {
      listKey = null;
      raw[key] = value;
    }
  }

  if (close === -1) {
    return {
      ok: false,
      data: null,
      present: true,
      body: lines.slice(start + 1).join("\n"),
      raw,
      errors: [
        "The frontmatter block is never closed — add a `---` line after the last field.",
        ...errors,
      ],
    };
  }

  const body = lines.slice(close + 1).join("\n").replace(/^\n+/, "");
  errors.push(...validateFields(raw));
  const name = raw.name ?? "";
  const description = raw.description ?? "";
  const category = raw.category ? normalizeFrontmatterCategory(raw.category) : null;
  const ok = errors.length === 0;
  return {
    ok,
    data: ok ? { name, description, category, tags: parseTagList(raw.tags ?? "") } : null,
    errors,
    present: true,
    body,
    raw,
  };
}

/** Field-level validation shared by parse (and reusable by a caller repairing a block). */
function validateFields(raw: Record<string, string>): string[] {
  const errors: string[] = [];
  const name = (raw.name ?? "").trim();
  if (!name) {
    errors.push("Frontmatter is missing required field `name` — a kebab-case slug, e.g. `pr-review-checklist`.");
  } else if (!SLUG_RE.test(name)) {
    errors.push(
      `Frontmatter \`name\` must be a kebab-case slug (lowercase letters, digits, single hyphens) — got "${name}". Try \`${slugifySkillName(name) || "my-skill"}\`.`,
    );
  } else if (name.length > MAX_NAME) {
    errors.push(`Frontmatter \`name\` must be ${MAX_NAME} characters or fewer.`);
  }

  const description = (raw.description ?? "").trim();
  if (!description) {
    errors.push(
      "Frontmatter is missing required field `description` — one sentence telling an agent when to use this skill.",
    );
  } else if (/\n/.test(description)) {
    errors.push("Frontmatter `description` must be a single paragraph on one line (quote it if it contains `:`).");
  } else if (description.length > MAX_DESCRIPTION) {
    errors.push(`Frontmatter \`description\` must be ${MAX_DESCRIPTION} characters or fewer.`);
  }

  if (raw.category !== undefined) {
    const cat = raw.category.trim();
    if (!cat) {
      errors.push(`Frontmatter \`category\` is empty — use one of: ${VALID_CATEGORIES}, or drop the field.`);
    } else if (!normalizeFrontmatterCategory(cat)) {
      errors.push(`Frontmatter \`category\` must be one of: ${VALID_CATEGORIES} — got "${cat}".`);
    }
  }
  return errors;
}

export interface FrontmatterDefaults {
  name: string;
  description: string;
  category?: string | null;
  tags?: string[];
}

/** Resolve the contract a document effectively declares: each valid declared field wins, else the default. */
function resolve(parsed: ParsedSkillFrontmatter, defaults: FrontmatterDefaults): SkillFrontmatter {
  const declaredName = (parsed.raw.name ?? "").trim();
  const name = SLUG_RE.test(declaredName) ? declaredName : slugifySkillName(defaults.name);
  const declaredDesc = (parsed.raw.description ?? "").trim();
  const description = declaredDesc || defaults.description.trim();
  const declaredCat = parsed.raw.category ? normalizeFrontmatterCategory(parsed.raw.category) : null;
  const category = declaredCat ?? (defaults.category ? normalizeFrontmatterCategory(String(defaults.category)) : null);
  const declaredTags = parseTagList(parsed.raw.tags ?? "");
  const tags = declaredTags.length ? declaredTags : (defaults.tags ?? []).slice(0, MAX_TAGS);
  return { name, description: description.slice(0, MAX_DESCRIPTION), category, tags };
}

/** Serialize a contract back into a `---` block (description always a quoted single line). */
export function serializeFrontmatter(fm: SkillFrontmatter): string {
  const safeDesc = fm.description.replace(/[\r\n]+/g, " ").replace(/"/g, "'").trim();
  const lines = [`name: ${fm.name}`, `description: "${safeDesc}"`];
  if (fm.category) lines.push(`category: ${fm.category}`);
  if (fm.tags.length) lines.push(`tags: ${fm.tags.join(", ")}`);
  return `---\n${lines.join("\n")}\n---`;
}

/**
 * Inject a frontmatter block when the document has none, or REPAIR the fields that don't validate —
 * declared-and-valid always wins over the default. The returned document is LF-normalized with exactly
 * one blank line between the block and the body.
 */
export function ensureFrontmatter(content: string, defaults: FrontmatterDefaults): string {
  const parsed = parseSkillFrontmatter(content);
  const fm = resolve(parsed, defaults);
  // `body` is the document minus the block when one was present, else the whole document.
  const body = parsed.body.replace(/^\s+/, "");
  return `${serializeFrontmatter(fm)}\n\n${body}`;
}

/**
 * READ-time backfill: the contract a stored skill effectively declares. Rows written before the contract
 * existed carry no block — their frontmatter is derived from the DB columns so the library still renders
 * (and a download still ships a conformant SKILL.md) WITHOUT rewriting stored content.
 */
export function effectiveSkillFrontmatter(content: string, defaults: FrontmatterDefaults): SkillFrontmatter {
  return resolve(parseSkillFrontmatter(content), defaults);
}

/** The DB columns a write should persist, reconciled with the document's frontmatter. */
export interface SkillWriteFields {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[];
}

export type SkillWriteReconciliation =
  | {
      ok: true;
      /** The content to store — unchanged when it already declared a valid block, repaired otherwise. */
      content: string;
      /** DB columns synced FROM the frontmatter (frontmatter wins on disagreement). */
      fields: { name: string; description: string; category: SkillCategory; tags: string[] };
      /** True when the block was missing and had to be injected from the request/DB defaults. */
      injected: boolean;
    }
  | { ok: false; errors: string[] };

/**
 * The write contract shared by create / update / push / promote:
 *   - a document that DECLARES a block must be valid — otherwise the write is rejected with the specific
 *     errors (never silently "fixed", or the author never learns their block is broken);
 *   - a valid block WINS over the request's name/description/category, and those DB columns are synced
 *     from it (one source of truth: the file the agent actually reads);
 *   - a document with NO block is wrapped from the supplied defaults, so authoring through the UI form
 *     still produces a conformant SKILL.md.
 */
export function reconcileSkillWrite(content: string, fields: SkillWriteFields): SkillWriteReconciliation {
  const parsed = parseSkillFrontmatter(content);
  if (parsed.present && !parsed.ok) return { ok: false, errors: parsed.errors };

  const name = slugifySkillName((fields.name ?? "").trim());
  const description = (fields.description ?? "").trim();
  if (!parsed.present) {
    // Injecting: the two required fields must come from somewhere, so demand them explicitly rather
    // than fabricating a description the agent would then trust.
    const errors: string[] = [];
    if (!name) errors.push("Provide a `name` (or a frontmatter block declaring one) — it becomes the skill's slug.");
    if (!description) {
      errors.push(
        "Provide a `description` (or a frontmatter block declaring one) — it is how an agent decides when to use this skill.",
      );
    }
    if (errors.length) return { ok: false, errors };
  }

  const resolved = resolve(parsed, {
    name: fields.name ?? "",
    description,
    category: fields.category ?? null,
    tags: fields.tags,
  });
  return {
    ok: true,
    content: parsed.present ? content : ensureFrontmatter(content, { ...resolved, category: resolved.category }),
    fields: {
      name: resolved.name,
      description: resolved.description,
      category: resolved.category ?? "other",
      tags: resolved.tags,
    },
    injected: !parsed.present,
  };
}
