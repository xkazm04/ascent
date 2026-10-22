// THE CLAIM FENCE, pure half. A leased claim's fence is its lease value: unique per claim, already
// stored, carried across rescans. An unleased claim (a human hand-off, a local lane) has a null fence,
// which keeps the "null is never expired" rule intact.

import { describe, expect, it } from "vitest";
import { fenceOf, fenceVerdict, staleClaimText } from "@/lib/org/followups-claims";

const F1 = "2026-10-22T10:45:00.000Z";
const F2 = "2026-10-22T11:30:00.000Z";

describe("fenceOf", () => {
  it("is the lease ISO for a leased claim and null for an unleased one", () => {
    expect(fenceOf(F1)).toBe(F1);
    expect(fenceOf(null)).toBeNull();
  });
});

describe("fenceVerdict", () => {
  it("accepts the current fence", () => {
    expect(fenceVerdict(F1, F1)).toBe("ok");
    // The same instant written another way is the same generation.
    expect(fenceVerdict(F1, "2026-10-22T10:45:00Z")).toBe("ok");
  });

  it("refuses a fence from an earlier generation as stale", () => {
    expect(fenceVerdict(F2, F1)).toBe("stale");
  });

  it("calls a presented fence stale when the row now has no lease, and when it is not a date", () => {
    expect(fenceVerdict(null, F1)).toBe("stale");
    expect(fenceVerdict(F1, "not-a-date")).toBe("stale");
  });

  it("names an absent fence on a leased row `unfenced`, and accepts it on an unleased row", () => {
    expect(fenceVerdict(F1, null)).toBe("unfenced");
    expect(fenceVerdict(F1, undefined)).toBe("unfenced");
    expect(fenceVerdict(F1, "")).toBe("unfenced");
    expect(fenceVerdict(null, null)).toBe("ok");
  });
});

describe("staleClaimText", () => {
  it("says the claim was superseded and names the current lease expiry", () => {
    const t = staleClaimText("rec-1", F2);
    expect(t).toContain("superseded");
    expect(t).toContain(F2);
    expect(t).not.toContain("You do not hold");
    expect(t).not.toContain(String.fromCharCode(0x2014));
  });

  it("says so plainly when the current claim carries no lease", () => {
    const t = staleClaimText("rec-1", null);
    expect(t).toContain("superseded");
    expect(t).toContain("no lease");
    expect(t).not.toContain(String.fromCharCode(0x2014));
  });
});
