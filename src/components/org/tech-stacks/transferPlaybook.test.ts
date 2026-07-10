// Pins the transformation playbook: a divergent move reads as a leader→laggard transfer aimed at the
// leader's score; a systemic gap reads as a fleet-wide build toward the maturity floor. The templated
// guidance is what the tech-stacks module promises IT leaders, so its shape shouldn't drift silently.

import { describe, it, expect } from "vitest";
import { buildPlaybook } from "@/components/org/tech-stacks/transferPlaybook";
import type { DimInsight } from "@/components/org/tech-stacks/fleetAnalysis";

const base = (over: Partial<DimInsight>): DimInsight => ({
  dimId: "D2",
  label: "Testing",
  min: 20,
  max: 96,
  mean: 58,
  spread: 76,
  fleet: 55,
  leader: { id: "be", name: "Backend · Rust", value: 96 },
  laggard: { id: "lib", name: "Library", value: 20 },
  klass: "divergent",
  count: 2,
  ...over,
});

describe("buildPlaybook", () => {
  it("frames a divergent dimension as a leader→laggard transfer toward the leader's score", () => {
    const p = buildPlaybook(base({}));
    expect(p.target).toBe(96);
    expect(p.changeTypes).toContain("culture");
    expect(p.steps).toHaveLength(4);
    expect(p.steps[0]).toContain("Backend · Rust"); // the model documents its practice
    expect(p.steps[1]).toContain("Library"); // the laggard pairs to learn
    expect(p.artifact.name).toMatch(/Testing/);
    expect(p.checklist[p.checklist.length - 1]).toContain("≥ 96");
  });

  it("frames a systemic gap as a fleet-wide build toward the maturity floor, not a transfer", () => {
    const p = buildPlaybook(base({ klass: "gap", dimId: "D9", label: "Security", max: 21, leader: { id: "fe", name: "Frontend", value: 21 } }));
    expect(p.target).toBe(60);
    expect(p.steps[0]).toMatch(/no internal leader/i);
    expect(p.checklist).toContain("Fleet Security above 60");
  });

  it("falls back cleanly for an unknown dimension id", () => {
    const p = buildPlaybook(base({ dimId: "D99", label: "Mystery" }));
    expect(p.artifact.name).toBe("Practice playbook");
    expect(p.steps).toHaveLength(4);
  });
});
