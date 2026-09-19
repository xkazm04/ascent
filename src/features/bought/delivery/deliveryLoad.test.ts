// G4-10: the Delivery tab's four rollup queries used to run behind a single `Promise.all`, which
// rejects on the FIRST failure and blanks all four panels. The fix moved to `Promise.allSettled` +
// these pure helpers (settle, deliveryEmptyMessage, aiRoiSpendKind) so the classification — "this
// section legitimately has nothing" vs "this section's query actually threw" — is unit-testable
// without rendering the async server component. Two invariants pinned below: a genuine query failure
// must NEVER be worded as "no data" / "go configure a GitHub token", and a failed usage query must
// NEVER be presented as "no cost source" (that is the successful-empty outcome).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { settle, deliveryEmptyMessage, aiRoiSpendKind, aiRoiUnavailableMessage } from "./deliveryLoad";

describe("settle", () => {
  it("a fulfilled result carries its value and failed:false", () => {
    const r: PromiseSettledResult<number> = { status: "fulfilled", value: 42 };
    expect(settle(r)).toEqual({ value: 42, failed: false });
  });

  it("a fulfilled result that legitimately resolved to null is STILL failed:false — null is a real, non-error outcome", () => {
    const r: PromiseSettledResult<null> = { status: "fulfilled", value: null };
    expect(settle(r)).toEqual({ value: null, failed: false });
  });

  it("a rejected result carries a null value and failed:true — the query genuinely threw", () => {
    const r: PromiseSettledResult<number> = { status: "rejected", reason: new Error("db blip") };
    expect(settle(r)).toEqual({ value: null, failed: true });
  });
});

describe("deliveryEmptyMessage — G4-10 failing-query fixture", () => {
  it("a genuine query failure gets an honest 'couldn't load' message, NEVER the GitHub-token nudge", () => {
    const msg = deliveryEmptyMessage({ anyFailed: true, segmentId: null, techGroupId: null });
    expect(msg).toMatch(/couldn't load/i);
    expect(msg).not.toMatch(/github token/i);
  });

  it("a genuine query failure wins over an active segment/stack filter — still no false 'pick another segment' framing", () => {
    // Even when a segment filter is active, a real failure must not be reframed as "wrong filter" —
    // that would send the reader chasing the filter instead of retrying.
    const msg = deliveryEmptyMessage({ anyFailed: true, segmentId: "seg1", techGroupId: null });
    expect(msg).toMatch(/couldn't load/i);
    expect(msg).not.toMatch(/filter/i);
  });

  it("no failure + an active segment/stack filter: the filter-scoped empty copy, not the whole-org token nudge", () => {
    const bySegment = deliveryEmptyMessage({ anyFailed: false, segmentId: "seg1", techGroupId: null });
    const byStack = deliveryEmptyMessage({ anyFailed: false, segmentId: null, techGroupId: "stack1" });
    expect(bySegment).toMatch(/this filter/i);
    expect(byStack).toMatch(/this filter/i);
  });

  it("no failure + no filter: the whole-org 'needs a GitHub token' copy", () => {
    const msg = deliveryEmptyMessage({ anyFailed: false, segmentId: null, techGroupId: null });
    expect(msg).toMatch(/github token/i);
    expect(msg).not.toMatch(/couldn't load/i);
  });
});

describe("aiRoiSpendKind — query failure ≠ no cost source", () => {
  it("a rejected usage query is unavailable, never 'none' (no cost source)", () => {
    expect(aiRoiSpendKind(null, true)).toBe("unavailable");
    expect(aiRoiSpendKind({ hasMeasured: false, hasAllocatedCost: false }, true)).toBe("unavailable");
  });

  it("failure wins over a leftover usage value — a throw is not a cost-source read", () => {
    expect(aiRoiSpendKind({ hasMeasured: true, hasAllocatedCost: true }, true)).toBe("unavailable");
  });

  it("a successful empty usage query is 'none' (no cost source), never unavailable", () => {
    expect(aiRoiSpendKind(null, false)).toBe("none");
    expect(aiRoiSpendKind({ hasMeasured: false, hasAllocatedCost: false }, false)).toBe("none");
  });

  it("a successful query with a cost source is present", () => {
    expect(aiRoiSpendKind({ hasMeasured: true, hasAllocatedCost: false }, false)).toBe("present");
    expect(aiRoiSpendKind({ hasMeasured: false, hasAllocatedCost: true }, false)).toBe("present");
  });
});

describe("aiRoiUnavailableMessage — failed load shows unavailable, not 'no cost source'", () => {
  it("names the load as unavailable and never says 'no cost source'", () => {
    const msg = aiRoiUnavailableMessage();
    expect(msg).toMatch(/unavailable/i);
    expect(msg).not.toMatch(/no cost source/i);
  });
});

const PANEL = fs.readFileSync(path.resolve(__dirname, "DeliveryCorePanel.tsx"), "utf8");

describe("DeliveryCorePanel — usage query failure ≠ no cost source", () => {
  it("classifies spend through aiRoiSpendKind and prints the unavailable copy", () => {
    expect(PANEL).toMatch(/aiRoiSpendKind\(usage, usageFailed\)/);
    expect(PANEL).toMatch(/aiRoiUnavailableMessage\(\)/);
  });

  it("does not feed a failed usage query into buildAiDeliveryModel (that is the no-cost-source input)", () => {
    expect(PANEL).toMatch(/spendKind === "unavailable" \? null : buildAiDeliveryModel/);
    expect(PANEL).not.toMatch(/buildAiDeliveryModel\(pr, usageFailed/);
  });
});
