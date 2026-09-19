// The AI-native repo STANDARD — generators for the `.ai/` foundation Ascent installs into a repo:
// the manifest (spine), the doctor (executable conformance), structured memory, and the CONTEXT
// graph, the guardrails, and the spec itself. Vendor-neutral and future-proof by design: the contract
// is authored at docs/features/onboarding/ai-manifest-spec.md and SHIPS with the foundation as .ai/SPEC.md. Thin barrel.

import type { ScanReport } from "@/lib/types";
import type { GeneratedFile } from "./types";
import { buildManifest } from "./manifest";
import { buildSpec } from "./spec";
import { buildDoctor } from "./doctor";
import { buildGuardrails } from "./guardrails";
import { buildConformanceWiring } from "./wiring";
import { buildMaintain } from "./maintain";
import { buildMemorySeed } from "./memory";
import { buildContextScaffold } from "./context";
import { buildOnboardingSkillFile } from "@/lib/onboarding/skill";

export { buildManifestData, serializeManifestYaml } from "./manifest";
// The READ-BACK half (#13): what the scan sees in a repo's own declared contract. Display-only.
export { readManifestYaml, readGuardrailsYaml, redactCommand } from "./read";
export { buildManifestReadout, parseManifestReadoutJson, verifiedCapabilities, MANIFEST_PATH } from "./readout";
export type { ManifestReadout, CapabilityReadout, ControlPlacement, ReadoutStatus } from "./readout";
export { buildSpec, SPEC_MD, SPEC_PATH } from "./spec";
export { buildDoctor } from "./doctor";
export { buildGuardrails, NEVER_COMMIT } from "./guardrails";
export { buildConformanceWiring } from "./wiring";
export { buildMaintain } from "./maintain";
export { buildMemorySeed } from "./memory";
export { buildContextScaffold } from "./context";
export type { GeneratedFile } from "./types";

/**
 * The `.ai/` tree only — what the onboarding skill embeds as Step 0, and what the doctor must pass
 * on a fresh install. Collision on files[0] (`.ai/manifest.yaml`) is what "already installed" looks
 * like to the PR installer. Split from `buildFoundation` so the skill can embed these without
 * embedding (or recursively generating) itself.
 */
export function buildStandardFiles(report: ScanReport): GeneratedFile[] {
  return [
    buildManifest(report),
    buildSpec(),
    buildDoctor(),
    buildGuardrails(),
    buildConformanceWiring(),
    buildMaintain(),
    ...buildMemorySeed(report),
    ...buildContextScaffold(report),
  ];
}

/**
 * Everything the foundation PR / local install lane commits: the `.ai/` standard plus the
 * personalized onboarding skill (same scan, same tracks as `GET /api/report/skill`). The skill is a
 * LATER file so a pre-existing `.claude/skills/ascent-onboard/SKILL.md` 409-skips instead of aborting
 * the install. Spine collision on files[0] still means "already installed".
 */
export function buildFoundation(report: ScanReport): GeneratedFile[] {
  return [...buildStandardFiles(report), buildOnboardingSkillFile(report)];
}
