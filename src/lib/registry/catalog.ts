// `catalog.json` — the GENERATED index every consumer syncs against.
//
// It is an ENVELOPE object, not a bare array (that is what the reference registry
// github.com/xkazm04/ai-registry ships, and the design doc's bare-array sketch is superseded): the
// wrapper carries the schema version, who generated it, which registry it describes and the counts,
// so a consumer can validate what it fetched before trusting the entries.
//
// `contentHash` is `sha256-n1:<first 16 hex>` — long enough to be a change key, short enough to read
// in a diff. It is the ONLY thing a fleet repo needs to answer "am I in sync, stale, or diverged?".

export const CATALOG_SCHEMA = "ascent-registry-catalog";
// 1.0.0 -> 1.1.0: every `contentHash` in the envelope changed form and value (see DIGEST_PREFIX below).
// Additive-compatible — the shape is untouched — so a 1.0.0 reader still parses a 1.1.0 catalog; what
// it must NOT do is diff a 1.0.0 digest against a 1.1.0 one and call the difference a content change.
export const CATALOG_SCHEMA_VERSION = "1.1.0";

// ── THE CONTENT DIGEST'S FORMAT ──────────────────────────────────────────────────────────────────
//
// A digest is only worth anything if both sides compute it identically, so the format states the
// recipe: `sha256-n1:<hex>` is sha256 over the artifact's FULL text with CRLF/CR folded to LF, where
// `n1` is normalization revision 1. The recipe itself lives in ONE function — `contentDigest` in
// `./parse` — which the catalog, the mirror rows and the skill sync manifest all call. A second copy
// of the arithmetic anywhere re-creates exactly the defect this format exists to close.
//
// WHAT THIS REPLACES: `sha256:<hex>` over the RAW fetched bytes, with no normalization at all, while
// the parser it fed explicitly advertises CRLF tolerance. A registry cloned onto a platform whose
// checkout rewrites line endings hashed differently on every single file and therefore reported EVERY
// artifact permanently diverged, for content nobody edited — the field was wrong in precisely the case
// it exists to detect, which teaches users to ignore the sync verdict entirely.
//
// WHY NOT MORE NORMALIZATION: trimming trailing whitespace, collapsing blank runs or folding unicode
// would make two GENUINELY different artifacts hash the same and hide a real divergence. That failure
// is strictly worse than the one being fixed (it is silent), so the normalization stops at the one
// transformation a version-control checkout performs without anyone asking for it.
//
// THE TRANSITION: the version tag means every stored digest changes at once. Rather than fire a
// one-time mass "diverged" event across the fleet, an untagged digest stays IDENTIFIABLE — see
// `digestVerdict`, which reports `"reformatted"` rather than `"changed"` when one side predates the
// tag, so a consumer says "recompute this" instead of "someone edited this".
export const DIGEST_ALGORITHM = "sha256";
export const DIGEST_NORMALIZATION = "n1";
export const DIGEST_PREFIX = `${DIGEST_ALGORITHM}-${DIGEST_NORMALIZATION}`;

/** Catalog short form: the digest's tag + the first 16 hex chars. Accepts a full tagged digest. */
export function shortDigest(digest: string): string {
  const i = digest.indexOf(":");
  const tag = i === -1 ? DIGEST_PREFIX : digest.slice(0, i);
  return `${tag}:${digest.slice(i + 1).slice(0, 16)}`;
}

/** True for a digest written before the `sha256-n1:` tag existed (bare hex, or the old `sha256:` form). */
export const isLegacyDigest = (digest: string) => Boolean(digest) && !digest.startsWith(`${DIGEST_PREFIX}:`);

/**
 * How to READ a difference between a stored digest and a freshly computed one.
 *
 * `reformatted` is the migration affordance: it means the two were produced by different digest
 * revisions, so they are not comparable and the difference says nothing about the content. A consumer
 * re-pulls and re-digests once; it does NOT report the artifact as diverged.
 */
export type DigestVerdict = "same" | "changed" | "reformatted" | "unknown";

export function digestVerdict(stored: string | null | undefined, fresh: string | null | undefined): DigestVerdict {
  if (!stored || !fresh) return "unknown";
  if (stored === fresh) return "same";
  if (isLegacyDigest(stored) !== isLegacyDigest(fresh)) return "reformatted";
  return "changed";
}

export interface CatalogSkillEntry {
  name: string;
  version: string | null;
  category: string;
  path: string;
  contentHash: string;
  applicability?: { dimensions?: string[]; appliesWhenBelow?: number };
  adopters?: string[];
  invokes30d?: number;
  lessons?: number;
  lessonsPath?: string;
  lessonsHash?: string;
}

export interface CatalogPracticeEntry {
  id: string;
  dimension: string;
  path: string;
  contentHash: string;
  starter: string[];
}

export interface CatalogMemoryEntry {
  kind: string;
  slug: string;
  path: string;
  contentHash: string;
  confidence: number;
  namespace: string | null;
  source: string | null;
}

export interface RegistryCatalog {
  schema: string;
  schemaVersion: string;
  /** ISO timestamp, or null in the deterministic seed the scaffold commits. */
  generatedAt: string | null;
  generatedBy: string;
  registry: {
    fullName: string;
    defaultBranch: string;
    canonical: boolean;
    mode: string;
    telemetry: string;
  };
  skills: CatalogSkillEntry[];
  practices: CatalogPracticeEntry[];
  memory: CatalogMemoryEntry[];
  counts: { skills: number; practices: number; memory: number; lessons: number };
}

export interface BuildCatalogInput {
  fullName: string;
  defaultBranch: string;
  canonical: boolean;
  /** YAML spelling: "git-native" | "hosted-mirror". */
  mode: string;
  telemetry: string;
  skills?: CatalogSkillEntry[];
  practices?: CatalogPracticeEntry[];
  memory?: CatalogMemoryEntry[];
  lessons?: number;
  generatedAt?: string | null;
  generatedBy?: string;
}

/**
 * Build the envelope. With no entries this is exactly the seed `buildScaffoldFiles` commits — empty
 * arrays, zero counts, `generatedAt: null` — which keeps the scaffold deterministic (a timestamp
 * would make every re-run a diff).
 */
export function buildCatalog(input: BuildCatalogInput): RegistryCatalog {
  const skills = input.skills ?? [];
  const practices = input.practices ?? [];
  const memory = input.memory ?? [];
  return {
    schema: CATALOG_SCHEMA,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedAt: input.generatedAt === undefined ? null : input.generatedAt,
    generatedBy: input.generatedBy ?? "ascent",
    registry: {
      fullName: input.fullName,
      defaultBranch: input.defaultBranch,
      canonical: input.canonical,
      mode: input.mode,
      telemetry: input.telemetry,
    },
    skills,
    practices,
    memory,
    counts: {
      skills: skills.length,
      practices: practices.length,
      memory: memory.length,
      lessons: input.lessons ?? skills.reduce((n, s) => n + (s.lessons ?? 0), 0),
    },
  };
}

/** Serialize with a trailing newline — the exact bytes committed, so a re-index diffs cleanly. */
export const serializeCatalog = (c: RegistryCatalog) => `${JSON.stringify(c, null, 2)}\n`;

/**
 * Read a catalog someone else (or a previous index) wrote. Returns null for anything that isn't this
 * schema, so a hand-mangled file degrades to "no previous catalog" instead of poisoning the index.
 * Unknown fields are preserved by being ignored — a newer minor schema still reads.
 */
export function parseCatalog(text: string): RegistryCatalog | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Partial<RegistryCatalog>;
  if (o.schema !== CATALOG_SCHEMA) return null;
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    schema: CATALOG_SCHEMA,
    schemaVersion: typeof o.schemaVersion === "string" ? o.schemaVersion : CATALOG_SCHEMA_VERSION,
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : null,
    generatedBy: typeof o.generatedBy === "string" ? o.generatedBy : "unknown",
    registry: {
      fullName: String(o.registry?.fullName ?? ""),
      defaultBranch: String(o.registry?.defaultBranch ?? "main"),
      canonical: Boolean(o.registry?.canonical ?? true),
      mode: String(o.registry?.mode ?? "git-native"),
      telemetry: String(o.registry?.telemetry ?? "off"),
    },
    skills: arr<CatalogSkillEntry>(o.skills),
    practices: arr<CatalogPracticeEntry>(o.practices),
    memory: arr<CatalogMemoryEntry>(o.memory),
    counts: {
      skills: Number(o.counts?.skills ?? 0) || 0,
      practices: Number(o.counts?.practices ?? 0) || 0,
      memory: Number(o.counts?.memory ?? 0) || 0,
      lessons: Number(o.counts?.lessons ?? 0) || 0,
    },
  };
}
