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

export { buildManifestData, serializeManifestYaml } from "./manifest";
export { buildSpec, SPEC_MD, SPEC_PATH } from "./spec";
export { buildDoctor } from "./doctor";
export { buildGuardrails, NEVER_COMMIT } from "./guardrails";
export { buildConformanceWiring } from "./wiring";
export { buildMaintain } from "./maintain";
export { buildMemorySeed } from "./memory";
export { buildContextScaffold } from "./context";
export type { GeneratedFile } from "./types";

/**
 * All foundation artifacts for a repo, in scaffold order: the manifest spine first (a collision on
 * it is what "already installed" looks like to the PR installer), then the spec it points at, the
 * doctor (so the maintainer can immediately get a conformance baseline), its guardrails and CI
 * backstop, then the memory and CONTEXT scaffolds. Everything the manifest points at is generated
 * here — the foundation must pass its own doctor on a fresh install. The onboarding skill writes
 * these before any dimension track; /api/report/foundation/pr commits them directly.
 */
export function buildFoundation(report: ScanReport): GeneratedFile[] {
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
