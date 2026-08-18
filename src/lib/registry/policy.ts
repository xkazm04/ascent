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
  policies: RegistryPolicies;
  owners: string[];
}

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

# Where invocation counts go. api = POST to ascent; registry = a telemetry/ folder in this repo;
# off = no counts at all. Counts only, never prompt or transcript text.
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
