// Parser-normal values for the five report columns the reconstruction used to drop. Each one is the
// exact shape its parser returns, so a decoded value can be compared with toEqual against the stored one.

import type { ContextHealth, GuidanceGraph, PlatformSignalRecord, ScanReport } from "@/lib/types";
import type { ManifestReadout } from "@/lib/standard/readout";
import type { RepoPracticeShape } from "@/lib/analyze/practice-shape";

/** A distinctive command, so the generated manifest can only carry it by reading the readout. */
export const OBSERVED_TEST_COMMAND = "pnpm run test:unit -- --reporter=dot";

export const MANIFEST: ManifestReadout = {
  status: "ok",
  readAt: "2026-06-18T00:00:00.000Z",
  generatedAt: "2026-06-01",
  schemaVersion: "1",
  schemaAhead: false,
  capabilities: [
    { name: "test", command: OBSERVED_TEST_COMMAND, verified: true, placeholder: false, wiredAt: ["prePush"] },
  ],
  controls: { prePush: ["test"], ciHardPass: [] },
  paths: { contextIndex: ".ai/context-index.json" },
  agents: [],
  purpose: "Widgets for acme.",
  boundaries: { neverTouch: [], secretsFrom: null },
  placeholders: [],
  unbacked: [],
  notes: [],
};

export const CONTEXT_HEALTH = {
  version: "1",
  present: true,
  score: 80,
  files: [{ path: "CLAUDE.md", sectionsScore: 70 }],
  freshness: { score: 90, ageDays: 3, commitsSinceEdit: 2, approximate: false },
  quality: { score: 75, signals: ["has-commands"] },
  drift: { score: 100, refsTotal: 4, deadRefs: [] },
} as unknown as ContextHealth;

export const GUIDANCE_GRAPH = {
  version: "1",
  nodes: [],
  edges: [],
  canonical: null,
  canonicalBasis: null,
  contradictions: [],
  coherence: 0.8,
  penalties: [],
} as unknown as GuidanceGraph;

export const PRACTICE_SHAPE: RepoPracticeShape = {
  version: "1",
  entries: [{ practiceId: "agent-guidance", path: "CLAUDE.md", outline: ["Commands"], layout: [] }],
} as unknown as RepoPracticeShape;

export const PLATFORM_SIGNALS: PlatformSignalRecord = {
  source: "observed",
  observedAt: "2026-06-18T00:00:00.000Z",
  dims: [{ dimId: "D2", points: 4, signals: ["branch protection"] }],
} as unknown as PlatformSignalRecord;

/** The five columns as persistScanReport writes them. */
export const FIVE_COLUMNS = {
  manifestJson: JSON.stringify(MANIFEST),
  contextHealthJson: JSON.stringify(CONTEXT_HEALTH),
  guidanceGraphJson: JSON.stringify(GUIDANCE_GRAPH),
  practiceShape: JSON.stringify(PRACTICE_SHAPE),
  platformSignalsJson: JSON.stringify(PLATFORM_SIGNALS),
};

/** The report fields those five columns decode to. */
export const FIVE_FIELDS: Pick<ScanReport, "manifest" | "contextHealth" | "guidanceGraph" | "practiceShape" | "platformSignals"> = {
  manifest: MANIFEST,
  contextHealth: CONTEXT_HEALTH,
  guidanceGraph: GUIDANCE_GRAPH,
  practiceShape: PRACTICE_SHAPE,
  platformSignals: PLATFORM_SIGNALS,
};
