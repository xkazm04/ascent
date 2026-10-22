import { describe, expect, it } from "vitest";
import {
  checkoutReturnCopy,
  deriveCheckoutReturn,
  isTerminalCheckoutReturn,
  pollDelayMs,
  type CheckoutReturnState,
} from "./checkoutReturnModel";

const ALL: CheckoutReturnState[] = ["unverified", "confirming", "paid", "landed", "stalled", "failed", "expired"];

describe("deriveCheckoutReturn", () => {
  it("confirmed is still confirming: payment processing, no 'received' claim", () => {
    const v = deriveCheckoutReturn({ checkoutStatus: "confirmed" });
    expect(v.state).toBe("confirming");
    expect(JSON.stringify(checkoutReturnCopy(v))).not.toMatch(/received/i);
  });

  it("succeeded without a grant record is paid, then stalled after ~10 min carrying the order id", () => {
    expect(deriveCheckoutReturn({ checkoutStatus: "succeeded", landed: false, elapsedMs: 60_000 }).state).toBe("paid");
    const stalled = deriveCheckoutReturn({ checkoutStatus: "succeeded", landed: false, elapsedMs: 11 * 60_000, orderId: "ord_9" });
    expect(stalled).toEqual({ state: "stalled", orderId: "ord_9" });
    expect(checkoutReturnCopy(stalled).body).toContain("ord_9");
  });

  it("landed only from a grant record, and renders the amount and the balance", () => {
    const v = deriveCheckoutReturn({ checkoutStatus: "succeeded", landed: { credits: 500, balance: 620 } });
    expect(v.state).toBe("landed");
    expect(checkoutReturnCopy(v).body).toContain("+500 credits, balance 620");
  });

  it("expired and failed are their own terminal states", () => {
    expect(deriveCheckoutReturn({ checkoutStatus: "expired" }).state).toBe("expired");
    expect(deriveCheckoutReturn({ checkoutStatus: "failed" }).state).toBe("failed");
  });

  it("no checkout to ask about is unverified and never claims a payment", () => {
    const v = deriveCheckoutReturn({ checkoutStatus: null });
    expect(v.state).toBe("unverified");
    const copy = checkoutReturnCopy(v);
    expect(copy.title).toBe("We could not confirm this payment yet.");
    expect(`${copy.title} ${copy.body}`).not.toMatch(/payment received/i);
  });

  it("polling stops at landed / failed / expired / unverified; stalled can still land", () => {
    expect(ALL.filter(isTerminalCheckoutReturn)).toEqual(["unverified", "landed", "failed", "expired"]);
  });

  it("backs off 2s, 4s, 8s, then caps at 15s", () => {
    expect([0, 1, 2, 3, 4, 9].map(pollDelayMs)).toEqual([2000, 4000, 8000, 15_000, 15_000, 15_000]);
  });

  it("no copy carries an em dash", () => {
    for (const state of ALL) {
      const c = checkoutReturnCopy({ state, orderId: "ord_1", credits: 1, balance: 2 });
      expect(`${c.title} ${c.body}`).not.toContain("\u2014");
    }
  });
});
