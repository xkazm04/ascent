// The live Registry view must not send pointing/synced as 0 before R5 exists.
// unmeasuredFleet is the block getRegistryView returns until that pass runs.

import { describe, expect, it } from "vitest";
import { unmeasuredFleet } from "./registry-view";

describe("unmeasuredFleet", () => {
  it("omits pointing and synced so a live view cannot send a measured 0 before R5", () => {
    const fleet = unmeasuredFleet(12);
    expect(fleet.reposTotal).toBe(12);
    expect("reposPointing" in fleet).toBe(false);
    expect("reposSynced30d" in fleet).toBe(false);
    expect(fleet.reposPointing).toBeUndefined();
    expect(fleet.reposSynced30d).toBeUndefined();
  });
});
