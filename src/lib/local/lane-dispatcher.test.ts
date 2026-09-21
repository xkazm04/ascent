// THE DISPATCH SEAM's registry (ADR-0001 §1). Small surface, one load-bearing property:
//
//   A DEPLOYMENT THAT HAS REGISTERED NO DISPATCHER REPORTS `false`, AND NOTHING REGISTERS ONE.
//
// That is not a default someone forgot to fill in — it is how the ADR's money precondition is
// enforced structurally. Metering and a per-lane spend ceiling are a precondition of the first hosted
// lane; until they exist, no dispatcher is installed, so `hostedDispatchAvailable()` is false, so the
// gate refuses every hosted arm attempt and no code path can spend. A test that let this quietly
// become `true` by default would remove the only thing standing between the tree and a live spend.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getLaneDispatcher, hostedDispatchAvailable, setLaneDispatcher, type HostedLaneRef, type LaneDispatcher } from "./lane-dispatcher";

const fake = (id: string, result = { ok: true, reason: null }): LaneDispatcher => ({
  id,
  dispatch: vi.fn(async () => result),
});

const lane: HostedLaneRef = { runId: "run1", laneId: "lane1", orgSlug: "acme", repoFullName: "acme/api", cycle: 1, batchIds: [] };

// The registry is process-global by design (Next bundles each route into its own chunk), so every
// test has to hand it back or the next one inherits a dispatcher it never installed.
afterEach(() => setLaneDispatcher(null));

describe("the dispatcher registry", () => {
  it("reports no worker, and hands back no dispatcher, until one is installed", () => {
    expect(hostedDispatchAvailable()).toBe(false);
    expect(getLaneDispatcher()).toBeNull();
  });

  it("reports a worker once one is installed", () => {
    setLaneDispatcher(fake("test-runner"));
    expect(hostedDispatchAvailable()).toBe(true);
    expect(getLaneDispatcher()?.id).toBe("test-runner");
  });

  it("is idempotent, and the last caller wins", () => {
    setLaneDispatcher(fake("first"));
    setLaneDispatcher(fake("second"));
    expect(getLaneDispatcher()?.id).toBe("second");
  });

  // Uninstalling has to work, and has to return the deployment to the refusing state rather than to
  // some "installed but broken" middle: a wedged worker is turned off by removing it.
  it("returns to reporting no worker when the dispatcher is removed", () => {
    setLaneDispatcher(fake("temp"));
    setLaneDispatcher(null);
    expect(hostedDispatchAvailable()).toBe(false);
    expect(getLaneDispatcher()).toBeNull();
  });
});

describe("the dispatcher contract", () => {
  // A refusal is DATA, never a throw. One lane that cannot be handed off must not abort the drain of
  // the rest — the cron route works a batch, and an exception would strand every lane behind it.
  it("lets an implementation refuse a lane without throwing", async () => {
    const d = fake("refuser", { ok: false, reason: "runner queue is full" });
    setLaneDispatcher(d);
    await expect(getLaneDispatcher()!.dispatch(lane)).resolves.toEqual({ ok: false, reason: "runner queue is full" });
  });

  it("passes the lane through to the installed implementation", async () => {
    const d = fake("recorder");
    setLaneDispatcher(d);
    await getLaneDispatcher()!.dispatch(lane);
    expect(d.dispatch).toHaveBeenCalledWith(lane);
  });
});
