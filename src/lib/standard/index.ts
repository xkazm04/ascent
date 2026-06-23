// The AI-native repo STANDARD — generators for the `.ai/` foundation Ascent installs into a repo:
// the manifest (spine), the doctor (executable conformance), structured memory, and the CONTEXT
// graph. Vendor-neutral and future-proof by design (see docs/AI_MANIFEST_SPEC.md). Thin barrel.

import type { ScanReport } from "@/lib/types";
import type { GeneratedFile } from "./types";
import { buildManifest } from "./manifest";
import { buildDoctor } from "./doctor";
import { buildConformanceWiring } from "./wiring";
import { buildMaintain } from "./maintain";
import { buildMemorySeed } from "./memory";
import { buildContextScaffold } from "./context";

export { buildManifest, buildManifestData, serializeManifestYaml } from "./manifest";
export { buildDoctor } from "./doctor";
export { buildConformanceWiring } from "./wiring";
export { buildMaintain } from "./maintain";
export { buildMemorySeed } from "./memory";
export { buildContextScaffold } from "./context";
export type { GeneratedFile } from "./types";

/**
 * All foundation artifacts for a repo, in scaffold order: the manifest spine first, then the doctor
 * (so the maintainer can immediately get a conformance baseline) and its CI backstop, then the
 * memory and CONTEXT scaffolds. The onboarding skill writes these before any dimension track.
 */
export function buildFoundation(report: ScanReport): GeneratedFile[] {
  return [
    buildManifest(report),
    buildDoctor(),
    buildConformanceWiring(),
    buildMaintain(),
    ...buildMemorySeed(report),
    ...buildContextScaffold(report),
  ];
}
