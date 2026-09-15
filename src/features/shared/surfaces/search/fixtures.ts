// Deterministic fixtures for the search scene: a fictional fleet of repositories, seeded (mulberry32),
// so every reader and every screenshot sees the same corpus at the same volume. No Math.random, no
// Date.now — `NOW` is a fixed instant. No React.
//
// SCHEMA is the ONE authority for every closed vocabulary the scene filters on: the query parser's
// field prefixes, the facet panel's option lists, the saved-view validator and the rule language's
// typing context all derive from it (one-authority-per-vocabulary). Nothing else lists a status.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export const STATUSES = ["ok", "warn", "fail", "archived"] as const;
export const LANGS = ["typescript", "python", "go", "rust", "java", "kotlin"] as const;
export const OWNERS = ["atlas", "borealis", "cinder", "dolomite", "ember", "fjord"] as const;
export const LEVELS = ["1", "2", "3", "4", "5"] as const;

export type Status = (typeof STATUSES)[number];
export type Lang = (typeof LANGS)[number];
export type Owner = (typeof OWNERS)[number];

export const SCHEMA = {
  owner: { type: "string", values: OWNERS as readonly string[] },
  status: { type: "string", values: STATUSES as readonly string[] },
  lang: { type: "string", values: LANGS as readonly string[] },
  level: { type: "int", values: LEVELS as readonly string[] },
} as const;
export type FacetField = keyof typeof SCHEMA;
export const FACET_FIELDS = Object.keys(SCHEMA) as FacetField[];
export const isFacetField = (s: string): s is FacetField => s in SCHEMA;

export type Repo = {
  id: string;
  owner: Owner;
  name: string;
  lang: Lang;
  status: Status;
  level: number;
  description: string;
  /** ms since epoch, fixed relative to NOW. */
  updatedAt: number;
  findings: number;
  tags: string[];
};

/** The scene's clock. A fixed instant, so "updated 3 days ago" is the same in every screenshot. */
export const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
const DAY = 86_400_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEADS = ["auth", "billing", "search", "deploy", "résumé", "telemetry", "cache", "ledger", "index", "payment", "docs", "ml", "fleet", "audit"];
const TAILS = ["Service", "Gateway", "Pipeline", "Worker", "Portal", "Kit", "Parser", "Engine", "Console", "Relay"];
const VERBS = ["Handles", "Serves", "Owns", "Indexes", "Reconciles", "Streams", "Renders", "Schedules"];
const TOPICS = ["authentication tokens", "invoice batches", "session events", "deploy manifests", "résumé uploads", "trace spans", "cache warming", "ledger entries", "search indexing", "card payments", "release notes", "model checkpoints"];
const AREAS = ["the fleet portal", "the mobile app", "partner integrations", "the data platform", "internal tooling", "the public API"];
const STATES = ["indexing of session events is slow", "retries are unbounded", "coverage gate is green", "the reindex job runs nightly", "telemetry sampling was reduced", "a rewrite is scheduled", "tokens rotate weekly"];
const TAGS = ["core", "edge", "legacy", "pilot", "regulated", "internal"];

const pick = <T,>(rnd: () => number, arr: readonly T[]): T => {
  const v = arr[Math.floor(rnd() * arr.length)];
  if (v === undefined) throw new Error("pick: empty pool"); // every pool above is a non-empty literal
  return v;
};

/** Two pinned rows the tests and the drawer prose point at, then `volume - 2` generated ones. */
const PINNED: Repo[] = [
  {
    id: "repo-1",
    owner: "atlas",
    name: "authService",
    lang: "typescript",
    status: "fail",
    level: 2,
    description: "Handles authentication tokens for the fleet portal; indexing of session events is slow.",
    updatedAt: NOW - 3 * DAY,
    findings: 14,
    tags: ["core", "regulated"],
  },
  {
    id: "repo-2",
    owner: "borealis",
    name: "résumé-parser",
    lang: "python",
    status: "warn",
    level: 3,
    description: "Parses résumé uploads for partner integrations; a rewrite is scheduled.",
    updatedAt: NOW - 40 * DAY,
    findings: 3,
    tags: ["pilot"],
  },
];

/** `volume` repositories with system-of-record identities (`repo-<n>`), never positional. */
export function repoRows(volume: SurfaceVolume, seed = 11): Repo[] {
  const rnd = mulberry32(seed);
  const out: Repo[] = [...PINNED];
  for (let i = PINNED.length; i < volume; i++) {
    const head = pick(rnd, HEADS);
    const tail = pick(rnd, TAILS);
    const r = rnd();
    out.push({
      id: `repo-${i + 1}`,
      owner: pick(rnd, OWNERS),
      name: i % 2 === 0 ? `${head}${tail}` : `${head}-${tail.toLowerCase()}`,
      lang: pick(rnd, LANGS),
      status: r > 0.92 ? "archived" : r > 0.72 ? "fail" : r > 0.45 ? "warn" : "ok",
      level: 1 + Math.floor(rnd() * 5),
      description: `${pick(rnd, VERBS)} ${pick(rnd, TOPICS)} for ${pick(rnd, AREAS)}; ${pick(rnd, STATES)}.`,
      updatedAt: NOW - Math.floor(rnd() * 400) * DAY,
      findings: Math.floor(rnd() * 40),
      tags: [pick(rnd, TAGS), pick(rnd, TAGS)].filter((t, i, a) => a.indexOf(t) === i),
    });
  }
  return out;
}

export const daysAgo = (t: number): number => Math.round((NOW - t) / DAY);

/** The results window: the point of the volume knob is the technique surviving 50,000 rows, not 50,000 nodes. */
export const PAGE_SIZE = 8;
