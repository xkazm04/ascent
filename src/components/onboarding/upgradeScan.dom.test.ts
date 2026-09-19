// @vitest-environment jsdom
//
// W6b: the one-shot preview-then-upgrade handoff flag. The guard rails under test are the ones that
// keep the auto-start from ever double-spending: strict one-shot consumption (refresh / StrictMode
// re-run gets nothing), tenant scoping (only the named org consumes; others leave it in place), and
// the staleness TTL (a parked tab must not fire a surprise scan hours later).

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setUpgradeScanFlag, consumeUpgradeScanFlag, UPGRADE_SCAN_TTL_MS } from "./upgradeScan";

const KEY = "ascent.upgrade-scan.v1";

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe("upgradeScan flag", () => {
  it("round-trips org + repos, exactly once (one-shot)", () => {
    setUpgradeScanFlag("acme", ["acme/api", "acme/web"]);
    expect(consumeUpgradeScanFlag("acme")).toEqual(["acme/api", "acme/web"]);
    // The refresh / StrictMode double-effect case: the key is already gone.
    expect(consumeUpgradeScanFlag("acme")).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("is tenant-scoped: a different org neither consumes nor destroys the flag", () => {
    setUpgradeScanFlag("acme", ["acme/api"]);
    expect(consumeUpgradeScanFlag("globex")).toBeNull();
    // Still there for the org it was written for.
    expect(consumeUpgradeScanFlag("acme")).toEqual(["acme/api"]);
  });

  it("discards (and removes) a stale flag past the TTL instead of auto-starting a forgotten scan", () => {
    vi.useFakeTimers();
    setUpgradeScanFlag("acme", ["acme/api"]);
    vi.advanceTimersByTime(UPGRADE_SCAN_TTL_MS + 1);
    expect(consumeUpgradeScanFlag("acme")).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("clears malformed payloads and returns null for empty repo lists", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(consumeUpgradeScanFlag("acme")).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    setUpgradeScanFlag("acme", []);
    expect(consumeUpgradeScanFlag("acme")).toBeNull();
  });
});
