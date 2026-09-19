import { describe, expect, it } from "vitest";
import { isLoopLanding, resolveLandingTab } from "./landing";
import { DEFAULT_ORG_TAB, isOrgTabId } from "./orgTabs";

describe("resolveLandingTab", () => {
  it("opens a never-scanned workspace on the baseline, not the loop", () => {
    // There is nothing in flight yet and nothing to be in flight ABOUT. Landing someone on an empty
    // war room before their first scan is the zero-state wall W6b removed, rebuilt in a new place.
    expect(resolveLandingTab({ scannedCount: 0, inFlightPrs: 0 })).toBe(DEFAULT_ORG_TAB);
  });

  it("opens a scanned org with PRs in flight on the loop", () => {
    expect(resolveLandingTab({ scannedCount: 4, inFlightPrs: 1 })).toBe("live");
  });

  it("rests on the baseline once the loop is quiet", () => {
    // Not a sticky mode: the moment the last PR lands, the fleet read is the right resting state.
    expect(resolveLandingTab({ scannedCount: 4, inFlightPrs: 0 })).toBe(DEFAULT_ORG_TAB);
  });

  // The guard that matters most: a stale/absent scan count must never route someone into the loop.
  // scannedCount is the gate, inFlightPrs alone is not.
  it("never lands on the loop without a completed scan, whatever the PR count says", () => {
    expect(resolveLandingTab({ scannedCount: 0, inFlightPrs: 9 })).toBe(DEFAULT_ORG_TAB);
  });

  it("always resolves to a real tab id", () => {
    for (const scannedCount of [0, 1, 50]) {
      for (const inFlightPrs of [0, 1, 50]) {
        expect(isOrgTabId(resolveLandingTab({ scannedCount, inFlightPrs }))).toBe(true);
      }
    }
  });
});

describe("isLoopLanding", () => {
  it("is true only when the decision moved the org off its default", () => {
    expect(isLoopLanding({ scannedCount: 4, inFlightPrs: 1 })).toBe(true);
    expect(isLoopLanding({ scannedCount: 4, inFlightPrs: 0 })).toBe(false);
    expect(isLoopLanding({ scannedCount: 0, inFlightPrs: 0 })).toBe(false);
  });
});
