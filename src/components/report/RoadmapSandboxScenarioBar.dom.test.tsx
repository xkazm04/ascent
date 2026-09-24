// @vitest-environment jsdom
//
// The saved-plan bar's projected-vs-actual line. Since 2026-09-23 a before/after pair scored under two
// rubric versions is refused by attribution (sameRuler), and the rubric moved three times in two days.
// A projection modeled under r19 against a scan scored under r21 must read NOT COMPARABLE: "5 pts short"
// would blame the team for a ruler change, "3 pts ahead" would credit them with one.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SandboxScenarioRecord } from "@/lib/db/sandbox-scenario";
import { ScenarioBar } from "./RoadmapSandboxScenarioBar";

function scenario(ruler: NonNullable<SandboxScenarioRecord["actual"]>["ruler"]): SandboxScenarioRecord {
  return {
    repo: "acme/web",
    authorLogin: "alice",
    overrides: {},
    itemKeys: [],
    baseline: { score: 54, level: "L3", scannedAt: "2026-06-01T00:00:00.000Z" },
    projected: { score: 66, level: "L4", delta: 12 },
    updatedAt: "2026-06-02T00:00:00.000Z",
    actual: { score: 61, level: "L3", scannedAt: "2026-07-01T00:00:00.000Z", delta: 7, ruler },
  };
}

function renderBar(s: SandboxScenarioRecord) {
  return render(
    <ScenarioBar scenario={s} state="idle" restored={false} anyChanged={false} onSave={() => {}} onDiscard={() => {}} />,
  );
}

describe("ScenarioBar projected-vs-actual", () => {
  it("guard: reports the gap when both scans share a ruler", () => {
    renderBar(scenario({ before: "r21", after: "r21", same: true }));
    expect(screen.getByText(/5 pts short so far/)).toBeTruthy();
  });

  it("labels a rubric change not comparable instead of a miss", () => {
    const { container } = renderBar(scenario({ before: "r19", after: "r21", same: false }));
    const text = container.textContent ?? "";
    expect(text).toContain("not comparable");
    expect(text).toContain("r19 to r21");
    expect(text).not.toMatch(/short so far|ahead of the model|exactly as modeled/);
  });

  it("labels an unrecorded rubric not comparable too", () => {
    const { container } = renderBar(scenario({ before: null, after: "r21", same: null }));
    expect(container.textContent).toContain("not comparable");
    expect(container.textContent).not.toMatch(/short so far/);
  });
});
