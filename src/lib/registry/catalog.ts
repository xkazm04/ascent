// `catalog.json` — the GENERATED index every consumer syncs against.
//
// It is an ENVELOPE object, not a bare array (that is what the reference registry
// github.com/xkazm04/ai-registry ships, and the design doc's bare-array sketch is superseded): the
// wrapper carries the schema version, who generated it, which registry it describes and the counts,
// so a consumer can validate what it fetched before trusting the entries.
//
// `contentHash` is `sha256:<first 16 hex>` — long enough to be a change key, short enough to read in
// a diff. It is the ONLY thing a fleet repo needs to answer "am I in sync, stale, or diverged?".

export const CATALOG_SCHEMA = "ascent-registry-catalog";
export const CATALOG_SCHEMA_VERSION = "1.0.0";

/** Short hash form the catalog stores: `sha256:` + the first 16 hex chars of the full digest. */
export const shortHash = (fullSha256Hex: string) => `sha256:${fullSha256Hex.slice(0, 16)}`;

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
  /**
   * Keys this builder does not own, carried through verbatim.
   *
   * The registry repo has a SECOND producer: its own `scripts/build-catalog.mjs`
   * writes a `bundles` array for the knowledge lane and derives each skill's
   * `invokes30d` from the `usage/` lane. Rebuilding the envelope from scratch
   * and committing it would erase both. Additive-within-major means a reader
   * ignores what it does not recognize — it does not mean a WRITER may delete it.
   */
  [extra: string]: unknown;
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
  /**
   * The catalog currently committed, when one was read. Keys this builder does
   * not own are copied from it; see `RegistryCatalog`'s index signature.
   */
  previous?: RegistryCatalog | null;
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

  // Everything the previous catalog carried that this builder has no opinion
  // about. Spread FIRST so the owned keys below win; a foreign key can never
  // shadow the schema id or the counts.
  const OWNED = new Set([
    "schema", "schemaVersion", "generatedAt", "generatedBy",
    "registry", "skills", "practices", "memory", "counts",
  ]);
  const carried: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.previous ?? {})) {
    if (!OWNED.has(k)) carried[k] = v;
  }

  return {
    ...carried,
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
