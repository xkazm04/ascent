// `.ascent/registry.yaml` — the registry's declaration of itself, and the only file whose ABSENCE
// means "this repo is not a registry".
//
// Parsed with a deliberately small YAML subset (scalars, one level of nesting, block sequences,
// `#` comments) rather than a YAML dependency: the file is a fixed, documented shape we also
// GENERATE, so a full parser would buy nothing but an attack surface and 40KB. Anything the subset
// can't read is IGNORED, which is the contract the file itself states ("Unknown fields MUST be
// ignored by a reader, so this file can grow without breaking old readers").
//
// Reference: https://github.com/xkazm04/ai-registry/blob/main/.ascent/registry.yaml

import { SKILL_CATEGORIES } from "@/lib/org/skill-categories";
import type { RegistryModeValue, TelemetrySinkValue } from "@/lib/db/org-registry";

/** The four `kind` values a memory note may declare — the closed set OrgMemory.kind stores. */
export const REGISTRY_MEMORY_KINDS = ["episodic", "semantic", "procedural", "summary"] as const;

/**
 * What ascent does with one of the lanes the registry's ROOT `registry.yaml` declares.
 *
 * `reader` — index the lane, never write to it. Every lane ascent understands today is a reader,
 * and for `usage/` that is load-bearing rather than incidental: the installations that RUN skills
 * count locally and each contribute one `usage/<contributor>.json`. Two writers on one number is
 * the failure those per-contributor files exist to prevent, so ascent sums what they published
 * and contributes nothing. `writer` is carried so a future lane can state the other relationship
 * without a schema break; nothing ascent emits uses it.
 */
export type RegistryLaneRole = "reader" | "writer";

/**
 * The lanes ascent indexes when the overlay does not say. Not a guess: it is what the indexer
 * hardcodes (`index-walk.ts` — skills/practices/memory artifacts plus `usage/<contributor>.json`),
 * so an older overlay written before the `lanes` block existed still describes ascent truthfully.
 */
export const DEFAULT_LANES: Readonly<Record<string, RegistryLaneRole>> = {
  skills: "reader",
  practices: "reader",
  memory: "reader",
  usage: "reader",
};

export interface RegistryPolicies {
  requireDescription: boolean;
  requireVersion: boolean;
  categories: string[];
  memoryKinds: string[];
  /** `bot` lets ascent commit catalog.json directly; `pr` makes it a pull request like everything else. */
  catalogWrites: "bot" | "pr";
}

export interface RegistryDeclaration {
  registry: number;
  canonical: boolean;
  mode: RegistryModeValue;
  telemetry: TelemetrySinkValue;
  /** Lane name -> ascent's role in it. A lane absent from the map is one ascent does not index. */
  lanes: Record<string, RegistryLaneRole>;
  policies: RegistryPolicies;
  owners: string[];
}

/**
 * Does the declaration give ascent permission to WRITE `lane`?
 *
 * The whole point of the field, expressed as the guard a write-back would have to pass. `usage/`
 * must answer false: ascent reads contributed counts and produces none of its own.
 */
export const writesLane = (d: RegistryDeclaration, lane: string): boolean => d.lanes[lane] === "writer";

export const DEFAULT_POLICIES: RegistryPolicies = {
  requireDescription: true,
  requireVersion: true,
  categories: [...SKILL_CATEGORIES],
  memoryKinds: [...REGISTRY_MEMORY_KINDS],
  catalogWrites: "bot",
};

/** The YAML spellings (`git-native`) vs the column values (`git_native`) — mapped in one place. */
const MODES: Record<string, RegistryModeValue> = {
  "git-native": "git_native",
  git_native: "git_native",
  "hosted-mirror": "hosted_mirror",
  hosted_mirror: "hosted_mirror",
};
const SINKS: Record<string, TelemetrySinkValue> = { api: "api", registry: "registry", off: "off" };

export const modeToYaml = (m: RegistryModeValue) => (m === "hosted_mirror" ? "hosted-mirror" : "git-native");

type Node = string | string[] | Record<string, string | string[]>;

/** Strip a trailing `# comment` that is not inside quotes, then trim. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] ?? " "))) return line.slice(0, i);
  }
  return line;
}

const unquote = (v: string) => v.trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();

/** Parse the supported subset into a shallow tree: top-level key -> scalar | list | one nested map. */
function parseTree(text: string): Record<string, Node> {
  const out: Record<string, Node> = {};
  let key: string | null = null;
  let child: string | null = null;

  for (const raw of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const t = line.trim();

    if (t.startsWith("- ")) {
      const item = unquote(t.slice(2));
      if (indent >= 4 && key && child && typeof out[key] === "object" && !Array.isArray(out[key])) {
        const map = out[key] as Record<string, string | string[]>;
        map[child] = [...(Array.isArray(map[child]) ? (map[child] as string[]) : []), item];
      } else if (key) {
        out[key] = [...(Array.isArray(out[key]) ? (out[key] as string[]) : []), item];
      }
      continue;
    }

    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(t);
    if (!m) continue;
    const k = m[1]!;
    const v = unquote(m[2] ?? "");

    if (indent === 0) {
      key = k;
      child = null;
      out[k] = v === "" ? {} : v;
    } else if (key) {
      // A nested key under the current top-level key; promote its container to a map if needed.
      if (typeof out[key] !== "object" || Array.isArray(out[key])) out[key] = {};
      (out[key] as Record<string, string | string[]>)[k] = v;
      child = k;
    }
  }
  return out;
}

const asBool = (v: unknown, fallback: boolean) =>
  typeof v === "string" ? /^(true|yes|1)$/i.test(v) : fallback;

const asList = (v: unknown, fallback: string[]) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : fallback;

/**
 * Read the `lanes:` map. An UNRECOGNIZED role is dropped rather than coerced — silently reading
 * `writer` as `reader` would invert the one fact this field exists to state — and a block that
 * yields nothing usable falls back to the documented defaults, same as every other field here.
 */
function asLanes(node: Node | undefined): Record<string, RegistryLaneRole> {
  if (typeof node !== "object" || Array.isArray(node) || node === null) return { ...DEFAULT_LANES };
  const out: Record<string, RegistryLaneRole> = {};
  for (const [lane, role] of Object.entries(node)) {
    if (Array.isArray(role)) continue;
    const r = String(role).trim().toLowerCase();
    if (r === "reader" || r === "writer") out[lane] = r;
  }
  return Object.keys(out).length ? out : { ...DEFAULT_LANES };
}

/**
 * Read `.ascent/registry.yaml`. Never throws: an unreadable or partial file yields the documented
 * defaults, because refusing to index a registry over a typo in its settings would be a worse
 * failure than indexing it with defaults and saying so.
 */
export function parseRegistryYaml(text: string): RegistryDeclaration {
  const tree = parseTree(text);
  const pol = (typeof tree.policies === "object" && !Array.isArray(tree.policies) ? tree.policies : {}) as Record<
    string,
    string | string[]
  >;
  const catalogWrites = String(pol.catalogWrites ?? "").toLowerCase() === "pr" ? "pr" : "bot";
  return {
    registry: Number.parseInt(String(tree.registry ?? "1"), 10) || 1,
    canonical: asBool(tree.canonical, true),
    mode: MODES[String(tree.mode ?? "").toLowerCase()] ?? "git_native",
    telemetry: SINKS[String(tree.telemetry ?? "").toLowerCase()] ?? "off",
    lanes: asLanes(tree.lanes),
    owners: asList(tree.owners, []),
    policies: {
      requireDescription: asBool(pol.requireDescription, DEFAULT_POLICIES.requireDescription),
      requireVersion: asBool(pol.requireVersion, DEFAULT_POLICIES.requireVersion),
      categories: asList(pol.categories, DEFAULT_POLICIES.categories),
      memoryKinds: asList(pol.memoryKinds, DEFAULT_POLICIES.memoryKinds),
      catalogWrites,
    },
  };
}

const list = (items: string[]) => items.map((i) => `    - ${i}`).join("\n");

const lanes = (m: Record<string, RegistryLaneRole>) =>
  Object.entries(m)
    .map(([lane, role]) => `  ${lane}: ${role}`)
    .join("\n");

/** Emit the file the scaffold seeds — the same key-for-key shape the fixture registry declares. */
export function serializeRegistryYaml(d: RegistryDeclaration): string {
  return `# The registry's declaration of itself. Ascent reads this when it maps and indexes the repo.
# Unknown fields MUST be ignored by a reader, so this file can grow without breaking old readers.

registry: ${d.registry}

# Exactly one registry per org is canonical. On a name collision across registries, the canonical
# one wins.
canonical: ${d.canonical}

# git-native  - content enters by pull request, ascent only reads. This is the default.
# hosted-mirror - content is authored in the ascent app and mirrored here.
mode: ${modeToYaml(d.mode)}

# Ascent's role in each lane the root \`registry.yaml\` declares. A lane named here is one ascent
# INDEXES; \`reader\` means it reads that lane and never writes to it. \`usage/\` is a reader by
# design: the installations that run the skills contribute the counts, one file each, and two
# writers on one number is the failure those per-contributor files exist to prevent.
lanes:
${lanes(d.lanes)}

# Where the invocation counts this consumer observes are sent. api = POST to ascent;
# registry = committed into this repo's usage/ lane; off = no counts at all. Counts only, never
# prompt or transcript text.
telemetry: ${d.telemetry}

policies:
  requireDescription: ${d.policies.requireDescription}
  requireVersion: ${d.policies.requireVersion}
  # The closed set an indexed SKILL.md may declare. Anything else is normalized to \`other\`.
  categories:
${list(d.policies.categories)}
  # The closed set a memory note may declare in its \`kind\` frontmatter.
  memoryKinds:
${list(d.policies.memoryKinds)}
  # Who may write catalog.json. \`bot\` lets ascent commit it directly; \`pr\` makes it a pull
  # request like everything else.
  catalogWrites: ${d.policies.catalogWrites}

${d.owners.length ? `owners:\n${d.owners.map((o) => `  - ${o}`).join("\n")}` : "owners: []"}
`;
}
