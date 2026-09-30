import { describe, expect, it } from "vitest";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { ladderSteps, migrationMark } from "./registryLadder";
import { registrySteps } from "./registryModel";

describe("registry ladder", () => {
  it("makes the first open step current and leaves later active steps open", () => {
    const view = fixtureRegistryView("acme", "indexed")!;
    const steps = ladderSteps(view);
    const current = steps.filter((s) => s.state === "current");
    expect(current).toHaveLength(1);
    expect(current[0]?.key).toBe("migrate");
    expect(steps.find((s) => s.key === "point")?.state).toBe("open");
    expect(steps.find((s) => s.key === "point")?.detail).toBe("next");
    expect(steps.find((s) => s.key === "choose")?.state).toBe("reached");
  });

  it("reads a skipped step as open, and keeps the v1 word", () => {
    const view = fixtureRegistryView("acme", "hosted")!;
    expect(registrySteps(view).find((s) => s.id === "migrate")?.state).toBe("skipped");
    const migrate = ladderSteps(view).find((s) => s.key === "migrate");
    expect(migrate?.state).toBe("open");
    expect(migrate?.detail).toBe("n/a");
  });

  it("maps migration without turning hosted into a zero", () => {
    expect(migrationMark("merged")).toEqual({ state: "met", word: "merged" });
    expect(migrationMark("pr-open")).toEqual({ state: "partial", word: "PR open" });
    expect(migrationMark("not-started")).toEqual({ state: "missing", word: "not started" });
    expect(migrationMark("n/a")).toEqual({ state: "unmeasured", word: "hosted" });
  });
});
