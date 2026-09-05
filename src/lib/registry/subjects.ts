// `knowledge/<domain>/index.json` → one row per SUBJECT (#18).
//
// The bundle's generated index is the only thing read. Walking the ~1,000 markdown documents behind
// it would blow the file cap, cost a request each, and make ascent a second authority for numbers the
// bundle's own generator already publishes — the same reasoning `readBundles` states for its `meta`
// counts. This goes one level deeper into the SAME file: `meta` says how many subjects there are,
// `subjects` says which ones and what governs them.
//
// Tolerant by the indexer's standing rule: a malformed bundle degrades ITSELF into a warning and the
// other bundles still land. This must never be the thing that fails a whole index pass.

/** One subject as its bundle's index states it. Every field is the bundle's to own. */
export interface KnowledgeSubject {
  bundle: string;
  slug: string;
  category: string | null;
  subcategory: string | null;
  /** The bundle's own lifecycle word (`forged`, `draft`, …). Null when it declares none — an
   *  unstated status is unknown, never "fine". */
  status: string | null;
  /** Repo-relative path of the subject's golden path, verbatim from the index. */
  file: string;
  techniqueCount: number;
  /** The union of every technique's consult triggers — what a reader is looking for when this
   *  subject is the right one to open. Deduped, in first-seen order. */
  useWhen: string[];
  /** The union of the cross-cutting laws this subject's techniques cite. */
  laws: string[];
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function pushUnique(into: string[], from: unknown, cap: number): void {
  if (!Array.isArray(from)) return;
  for (const v of from) {
    if (typeof v !== "string" || !v.trim()) continue;
    const s = v.trim();
    if (into.length >= cap) return;
    if (!into.includes(s)) into.push(s);
  }
}

/** Bounds on the two unions, so one enormous subject cannot dominate a row's stored JSON. Exceeding
 *  them truncates the LIST, never the count — `techniqueCount` stays honest. */
const MAX_USE_WHEN = 60;
const MAX_LAWS = 40;

/**
 * Read every bundle index into subject rows. `files` is the same list `readBundles` gets, so one
 * fetch feeds both readers.
 */
export function readBundleSubjects(
  files: { path: string; text: string | null }[],
  warnings: string[],
): KnowledgeSubject[] {
  const out: KnowledgeSubject[] = [];
  for (const { path, text } of files) {
    if (text === null) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      // `readBundles` already warns about the same file's JSON; keep the message distinct so a
      // reader can tell WHICH reader gave up rather than seeing the same line twice.
      warnings.push(`${path}: not valid JSON — subjects not indexed`);
      continue;
    }
    const root = doc as { meta?: { bundle?: unknown }; subjects?: unknown };
    const bundle = strOrNull(root?.meta?.bundle) ?? path.split("/")[1] ?? null;
    if (!bundle) {
      warnings.push(`${path}: no bundle name — subjects not indexed`);
      continue;
    }
    const subjects = root?.subjects;
    // `subjects` is a MAP KEYED BY SLUG, not an array. The dossier assumed an array with a `title`;
    // the generated index has neither, so the slug IS the identity and there is no title to store.
    if (!subjects || typeof subjects !== "object" || Array.isArray(subjects)) {
      warnings.push(`${path}: no subjects map — subjects not indexed`);
      continue;
    }
    for (const [slug, raw] of Object.entries(subjects as Record<string, unknown>)) {
      const s = raw as { category?: unknown; subcategory?: unknown; status?: unknown; file?: unknown; techniques?: unknown };
      if (!s || typeof s !== "object") {
        warnings.push(`${path}: subjects["${slug}"] is not an object — subject skipped`);
        continue;
      }
      const file = strOrNull(s.file);
      if (!file) {
        // Without a file the row cannot be linked to anything the reader could open, and a subject
        // nobody can reach is not worth asserting exists.
        warnings.push(`${path}: subjects["${slug}"] has no file — subject skipped`);
        continue;
      }
      const techniques = Array.isArray(s.techniques) ? s.techniques : [];
      const useWhen: string[] = [];
      const laws: string[] = [];
      for (const t of techniques) {
        const tech = t as { use_when?: unknown; laws?: unknown };
        pushUnique(useWhen, tech?.use_when, MAX_USE_WHEN);
        pushUnique(laws, tech?.laws, MAX_LAWS);
      }
      out.push({
        bundle,
        slug,
        category: strOrNull(s.category),
        subcategory: strOrNull(s.subcategory),
        status: strOrNull(s.status),
        file,
        techniqueCount: techniques.length,
        useWhen,
        laws,
      });
    }
  }
  return out.sort((a, b) => a.bundle.localeCompare(b.bundle) || a.slug.localeCompare(b.slug));
}
