// `knowledge/<domain>/taxonomy.json` → the bundle's category tree, mirrored onto the registry row.
//
// The taxonomy is the registry's AUTHORITY on where a subject lives (its own `$comment` says the
// folder tree is derived from it, never the other way round), so it is the one file that can give
// the Knowledge tab category and subcategory TITLES — `index.json` carries only the ids. Read the
// way every bundle file is read here: tolerant per bundle, a warning for a bundle whose taxonomy
// is missing or malformed, never a failed index pass. A bundle without one mirrors `[]`, and the
// tab derives titles from ids instead (`KnowledgeDomain.taxonomy`'s doc comment).

import type { KnowledgeCategory, KnowledgeSubcategory } from "@/lib/org/knowledge-shape";
import { REGISTRY_KNOWLEDGE_DIR } from "./layout";

export const TAXONOMY_SCHEMA = "rkb-taxonomy/1";

/** `knowledge/<domain>/taxonomy.json` — exactly one level under `knowledge/`, like the index. */
export const isBundleTaxonomy = (path: string): boolean => {
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === REGISTRY_KNOWLEDGE_DIR && parts[2] === "taxonomy.json";
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/**
 * Normalize one taxonomy document. `subjects` and `subcategories` are ALWAYS arrays; `order`
 * defaults to the category's array index, so a taxonomy that never wrote `order` still has a stable
 * declared order. Returns null (with a reason) for a document that is not a taxonomy at all.
 */
export function parseTaxonomy(text: string): { ok: true; bundle: string | null; categories: KnowledgeCategory[] } | { ok: false; reason: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "not an object" };
  const d = doc as Record<string, unknown>;
  const schema = str(d.schema);
  if (schema !== TAXONOMY_SCHEMA) return { ok: false, reason: `schema is ${schema ?? "absent"}, expected ${TAXONOMY_SCHEMA}` };
  if (!Array.isArray(d.categories)) return { ok: false, reason: "no categories array" };

  const categories: KnowledgeCategory[] = [];
  d.categories.forEach((raw, index) => {
    const c = raw as Record<string, unknown>;
    const id = str(c?.id);
    if (!id) return;
    const subcategories: KnowledgeSubcategory[] = [];
    for (const rawSub of Array.isArray(c.subcategories) ? c.subcategories : []) {
      const s = rawSub as Record<string, unknown>;
      const subId = str(s?.id);
      if (!subId) continue;
      subcategories.push({ id: subId, title: str(s.title) ?? subId, subjects: strings(s.subjects) });
    }
    categories.push({
      id,
      title: str(c.title) ?? id,
      order: typeof c.order === "number" && Number.isFinite(c.order) ? c.order : index,
      subjects: strings(c.subjects),
      subcategories,
    });
  });
  return { ok: true, bundle: str(d.bundle), categories };
}

/**
 * Every taxonomy the pass read, keyed by bundle name (the document's own `bundle`, else the
 * directory). A missing or unreadable file is a warning and an absent key; the caller mirrors `[]`.
 */
export function readBundleTaxonomies(
  files: { path: string; text: string | null }[],
  warnings: string[],
): Map<string, KnowledgeCategory[]> {
  const out = new Map<string, KnowledgeCategory[]>();
  for (const { path, text } of files) {
    if (text === null) continue;
    const parsed = parseTaxonomy(text);
    if (!parsed.ok) {
      warnings.push(`${path}: ${parsed.reason} — taxonomy not mirrored`);
      continue;
    }
    out.set(parsed.bundle ?? path.split("/")[1]!, parsed.categories);
  }
  return out;
}
