// `.ai/guardrails.yaml` — the invariants half of the standard. The manifest says what the repo CAN
// do; this says what an agent MUST NOT do.
//
// It exists because `paths.guardrails` used to point at a file the foundation never generated: a
// dangling pointer in the very contract that sells "pointers, not embeds". Rather than drop the
// pointer we made it real, and — critically — made part of it MACHINE-CHECKED: the doctor fails when
// git tracks a file matching `secrets.neverCommit`. An invariants file nothing enforces is just prose.
//
// The shape is a regular, regex-friendly YAML subset (flow lists) so the zero-dependency doctor can
// read it with the same helpers it uses on the manifest. Pure and deterministic.

import type { GeneratedFile } from "./types";
import { GUARDRAILS_SCHEMA_VERSION } from "./types";

/**
 * Conservative, cross-stack never-commit patterns. Deliberately EXCLUDES near-miss globs that match
 * legitimate committed files (`.env.example`, `*.key` used for non-secret key material) — a guardrail
 * that cries wolf on a fresh install is the failure mode this whole direction exists to remove.
 */
export const NEVER_COMMIT = [".env", ".env.local", "*.pem", "*.p12", "*.pfx", "id_rsa", "id_dsa"];

export function buildGuardrails(): GeneratedFile {
  // Seeded empty — a scan can't tell which dirs are generated/vendored, so the agent fills it in
  // (the same honesty rule the manifest's TODO markers follow: leave a marker, never invent).
  const neverTouch = "[]";
  const body = `# .ai/guardrails.yaml — machine-checkable invariants for any agent working in this repo.
# Pointed at from .ai/manifest.yaml (paths.guardrails). The doctor ENFORCES what a machine can check
# (see \`node .ai/doctor.mjs\`); the rest is contract for the agent that reads this file.
# Open + must-ignore-unknown, like the manifest: add your own rules freely.
schema: ai-guardrails
schemaVersion: ${GUARDRAILS_SCHEMA_VERSION}

# Paths an agent must NEVER hand-edit (generated, vendored, lockfiles). Keep in sync with the
# manifest's boundaries.neverTouch. Example: [dist/, vendor/, "*.lock", src/generated/]
neverTouch: ${neverTouch}

secrets:
  # DOCTOR-ENFORCED: if git tracks a file matching any of these, the conformance gate HARD FAILS.
  # Add repo-specific patterns; keep them precise (a pattern that matches a legitimate committed
  # file — e.g. .env.example — turns the gate into noise).
  neverCommit: [${NEVER_COMMIT.map((p) => (/^[\w./@-]+$/.test(p) ? p : JSON.stringify(p))).join(", ")}]
  # Where secrets legitimately come from — a vault/keyring NAME, never a secret.
  from: "TODO: the vault/keyring this repo reads secrets from"

# Change discipline. These are the non-negotiables of agent-driven development in this repo.
review:
  humanApproval: required   # never auto-merge; a human confirms every change
  verifyBeforePropose: true # run the manifest's capabilities before proposing a diff
  attributeAiWork: true     # keep the history honest (e.g. a Co-Authored-By trailer)
`;
  return {
    path: ".ai/guardrails.yaml",
    body,
    purpose: "Machine-checkable invariants: never-commit secrets (doctor-enforced), never-touch paths, review discipline.",
    lang: "yaml",
  };
}
