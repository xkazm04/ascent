// Verdict and stepper copy must not paint fleet pointing/synced as 0 before R5.
// A missing count is unmeasured; a 0 is "we looked and nobody points".

import { describe, expect, it } from "vitest";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import type { RegistryView } from "@/lib/org/registry-view";
import { registrySteps, registryVerdict } from "./registryModel";

function withFleet(fleet: RegistryView["fleet"]): RegistryView {
  const base = fixtureRegistryView("acme", "indexed")!;
  return { ...base, fleet };
}

const UNMEASURED = { reposTotal: 34, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 } } as const;

describe("registryVerdict — fleet pointing", () => {
  it("omits the pointing fraction when R5 has not run", () => {
    const line = registryVerdict(withFleet(UNMEASURED));
    expect(line).toMatch(/fleet pointing not measured yet/);
    expect(line).not.toMatch(/\d+\/\d+ repos pointing/);
    expect(line).not.toMatch(/every pointing repo in sync/);
  });

  it("names the pointing fraction once a pass supplied it", () => {
    expect(registryVerdict(fixtureRegistryView("acme", "indexed")!)).toMatch(/27\/34 repos pointing/);
  });

  it("measured pointing with all-zero adoption does not claim the pointing repos are in sync", () => {
    const line = registryVerdict(
      withFleet({ reposTotal: 5, reposPointing: 3, reposSynced30d: 2, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 } }),
    );
    expect(line).toContain("3/5 repos pointing");
    expect(line).not.toContain("every pointing repo in sync");
  });
});

describe("registrySteps — point / verify", () => {
  it("does not write 0/N into the point or verify details before R5", () => {
    const byId = Object.fromEntries(registrySteps(withFleet(UNMEASURED)).map((s) => [s.id, s]));
    expect(byId.point!.detail).toMatch(/not measured yet/i);
    expect(byId.point!.detail).not.toMatch(/\d+\/\d+/);
    expect(byId.verify!.detail).toMatch(/sync unmeasured/);
    expect(byId.verify!.detail).not.toMatch(/0 synced/);
    expect(byId.point!.state).toBe("active");
    expect(byId.verify!.state).toBe("active");
  });

  it("point is done when every repo carries the pointer, and names the fraction while it is not", () => {
    const ZERO = { inSync: 0, stale: 0, diverged: 0, localOnly: 0 };
    const all = Object.fromEntries(registrySteps(withFleet({ reposTotal: 4, reposPointing: 4, reposSynced30d: 4, adoption: ZERO })).map((s) => [s.id, s]));
    expect(all.point!.state).toBe("done");
    const half = Object.fromEntries(registrySteps(withFleet({ reposTotal: 4, reposPointing: 2, reposSynced30d: 1, adoption: ZERO })).map((s) => [s.id, s]));
    expect(half.point!.state).toBe("active");
    expect(half.point!.detail).toBe("2/4 repos carry the pointer");
  });

  it("keeps the pointing fraction when a pass supplied it", () => {
    const byId = Object.fromEntries(registrySteps(fixtureRegistryView("acme", "indexed")!).map((s) => [s.id, s]));
    expect(byId.point!.detail).toBe("27/34 repos carry the pointer");
    expect(byId.verify!.detail).toMatch(/22 synced/);
  });
});
