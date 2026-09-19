// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComparableScan } from "@/lib/db/scans";
import type { ScanDiff } from "@/lib/report/compare";
import { postureFor } from "@/lib/maturity/model";
import { MIXED_ENGINE_PAIR_LABEL } from "@/components/report/chartEngine";
import { WhatChanged } from "./WhatChanged";

const posture = postureFor(50, 50);

function scan(over: Partial<ComparableScan> & { id: string }): ComparableScan {
  return {
    id: over.id,
    scannedAt: over.scannedAt ?? "2026-07-01T00:00:00.000Z",
    overallScore: over.overallScore ?? 50,
    level: over.level ?? "L3",
    levelName: over.levelName ?? "Augmented",
    archetype: over.archetype ?? "org",
    adoptionScore: over.adoptionScore ?? 50,
    rigorScore: over.rigorScore ?? 50,
    posture: over.posture ?? posture.label,
    confidence: over.confidence ?? 0.8,
    engineProvider: over.engineProvider ?? "claude-cli",
    engineModel: over.engineModel ?? "sonnet",
    headSha: over.headSha ?? null,
    dimensions: over.dimensions ?? [],
    recommendations: over.recommendations ?? [],
  };
}

function diff(over: Partial<ScanDiff> = {}): ScanDiff {
  return {
    overall: { before: 50, after: 62, delta: 12 },
    level: {
      before: { id: "L3", name: "Augmented" },
      after: { id: "L3", name: "Augmented" },
      changed: false,
      up: false,
    },
    adoption: { before: 50, after: 50, delta: 0 },
    rigor: { before: 50, after: 50, delta: 0 },
    posture: { before: posture, after: posture, changed: false },
    dimensions: [],
    recsMovedToDone: [],
    closedGapCount: 0,
    openedGapCount: 0,
    appearedSignalCount: 0,
    disappearedSignalCount: 0,
    movements: [],
    unchanged: false,
    ...over,
  };
}

describe("WhatChanged — mixed-engine pairs are labelled", () => {
  it("caveats a mock vs live pair next to the overall delta", () => {
    render(
      <WhatChanged
        diff={diff()}
        before={scan({ id: "before", engineProvider: "mock", engineModel: "deterministic" })}
        after={scan({ id: "after", overallScore: 62, engineProvider: "claude-cli" })}
      />,
    );
    expect(screen.getByTestId("what-changed")).toBeInTheDocument();
    expect(screen.getByTestId("mixed-engine-pair")).toHaveTextContent(MIXED_ENGINE_PAIR_LABEL);
    expect(screen.getByText(/overall/i)).toBeInTheDocument();
  });

  it("does not label two live-model scans", () => {
    render(
      <WhatChanged
        diff={diff()}
        before={scan({ id: "before", engineProvider: "claude-cli" })}
        after={scan({ id: "after", overallScore: 62, engineProvider: "bedrock" })}
      />,
    );
    expect(screen.queryByTestId("mixed-engine-pair")).toBeNull();
  });
});
