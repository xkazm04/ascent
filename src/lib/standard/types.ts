// The AI-native repo STANDARD — shared types for the artifacts Ascent generates into a repo so it
// becomes legible, verifiable, and self-maintaining for agents. Vendor-neutral by design: the
// artifacts live under `.ai/` and never name a specific tool as identity.
//
// Future-proofing rules these types encode:
//  - Capabilities, not tools: a capability is a NAME → the COMMAND that fulfils it (test → "npm
//    test"), never "framework: vitest". Tools churn; capabilities endure.
//  - Pointers, not embeds: heavy subsystems (memory, context graph, evals, guardrails) are
//    referenced by path, so their formats can change without breaking this contract.
//  - Open + versioned: `capabilities` is an open map and readers must ignore unknown fields, so new
//    capability kinds need no schema migration; `schemaVersion` is semver.

import type { RepoArchetype } from "@/lib/types";

/** A file the standard generates for a target repo (written verbatim, or embedded in the skill). */
export interface GeneratedFile {
  /** Repo-relative path. */
  path: string;
  /** Full file body. */
  body: string;
  /** One-line purpose, shown when the skill lists what it will write. */
  purpose: string;
  /** Fence language hint when embedded in markdown (yaml | json | javascript | markdown). */
  lang: "yaml" | "json" | "javascript" | "markdown";
}

/** A tool-neutral capability: the command that fulfils a named ability. `verified` is a claim the
 *  doctor flips to true once it has actually run the command. */
export interface Capability {
  command: string;
  verified: boolean;
}

/** The structured manifest. The YAML/JSON serialization is a VIEW of this object, so the on-disk
 *  format can evolve without changing the contract callers depend on. */
export interface ManifestData {
  /** Stable schema id (not a URL, so it can't rot). */
  schema: "ai-manifest";
  /** Semver of the schema. Readers ignore unknown fields; bumps are additive within a major. */
  schemaVersion: string;
  /** Where the human-readable contract lives in-repo. */
  spec: string;
  /** YYYY-MM-DD the manifest was generated. */
  generatedAt: string;
  /** Repo files the manifest was synthesized from — the doctor drift-checks these. */
  generatedFrom: string[];
  repo: {
    name: string;
    purpose: string;
    /** Descriptive language tags, never a tool/framework. */
    languages: string[];
    archetype: RepoArchetype;
  };
  /** Open map: capability name → command. Add keys freely; older readers ignore unknowns. */
  capabilities: Record<string, Capability>;
  /** Pointers to the rest of the system — formats can change underneath these paths. */
  paths: {
    contextIndex: string;
    memory: string;
    evals: string;
    guardrails: string;
  };
  context: {
    /** The structural rule the doctor enforces (e.g. "every module dir over N files has CONTEXT.md"). */
    rule: string;
  };
  boundaries: {
    /** Paths agents must never hand-edit (generated code, vendored). */
    neverTouch: string[];
    /** Where secrets legitimately come from (a vault/keyring name, not the secrets). */
    secretsFrom: string;
  };
  /** Vendor-neutral agent registry — any coding agent, not one brand. */
  agents: { id: string; kind: string; entrypoint: string }[];
  /** The control model (shift-left): which layer primarily enforces each capability. */
  controls: {
    prePush: string[];
    ciHardPass: string[];
  };
}

/** The schema version this build of Ascent emits. */
export const MANIFEST_SCHEMA_VERSION = "0.1.0";
