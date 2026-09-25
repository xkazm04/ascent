// The desk is reached by a sibling view's href, so the switch keeps every scope param without each
// caller threading one more href through; the On Air wall is the theater page with its wall named.

import { describe, expect, it } from "vitest";
import { liveViewHref, onAirHref, siblingViewHref } from "./LiveViewSwitch";

describe("siblingViewHref", () => {
  it("swaps only the view and keeps the stack scope", () => {
    const ledger = liveViewHref({ tab: "live", stack: "frontend", view: "ledger" }, "ledger");
    const desk = new URLSearchParams(siblingViewHref(ledger, "desk").slice(1));
    expect(desk.get("view")).toBe("desk");
    expect(desk.get("stack")).toBe("frontend");
    expect(desk.get("tab")).toBe("live");
  });

  it("adds a view to an href that had none", () => {
    expect(siblingViewHref("?tab=live", "desk")).toBe("?tab=live&view=desk");
  });
});

describe("onAirHref", () => {
  it("is the theater page with the multiview wall named", () => {
    expect(onAirHref("acme co")).toBe("/theater/acme%20co?wall=onair");
  });
});
