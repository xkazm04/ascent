import { describe, it, expect } from "vitest";
import { allotmentRead } from "./AllotmentPanel";

describe("allotmentRead — burn-vs-allotment right-sizing", () => {
  it("returns null only for the unlimited (Enterprise) plan; Free now has a 10/mo allowance to track", () => {
    expect(allotmentRead("enterprise", 5000, 30)).toBeNull();
    const free = allotmentRead("free", 5, 30)!;
    expect(free.included).toBe(10);
    expect(free.monthlyBurn).toBe(5);
  });

  it("normalizes the period burn to a monthly rate (window-independent %)", () => {
    // 90 billable over 90 days = 30/mo; against Team's 500 allotment => 6%.
    const r = allotmentRead("team", 90, 90)!;
    expect(r.included).toBe(500);
    expect(r.monthlyBurn).toBe(30);
    expect(r.pct).toBe(6);
  });

  it("flags 'under' (downgrade hint) when sustained burn is < 25% of allotment", () => {
    const r = allotmentRead("team", 60, 30)!; // 60/mo of 500 = 12%
    expect(r.fit).toBe("under");
  });

  it("flags 'over' (top-up/upgrade before the 402) when burn exceeds 90% of allotment", () => {
    const r = allotmentRead("pro", 95, 30)!; // 95/mo of 100 = 95%
    expect(r.pct).toBe(95);
    expect(r.fit).toBe("over");
  });

  it("is 'ok' in the comfortable middle, and never 'under' at zero burn (nothing to right-size yet)", () => {
    expect(allotmentRead("team", 250, 30)!.fit).toBe("ok"); // 50%
    expect(allotmentRead("team", 0, 30)!.fit).toBe("ok"); // 0 burn → not an idle-downgrade signal
  });
});
