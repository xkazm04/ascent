import { describe, expect, it } from "vitest";
import { resolveBillingReturn } from "./overviewBilling";

describe("resolveBillingReturn", () => {
  it("returns null when there is no credits param", () => {
    expect(resolveBillingReturn("acme", {})).toBeNull();
    expect(resolveBillingReturn("acme", { credits: "whatever" })).toBeNull();
  });

  it("reads both documented statuses", () => {
    expect(resolveBillingReturn("acme", { credits: "pending" })?.status).toBe("pending");
    expect(resolveBillingReturn("acme", { credits: "error" })?.status).toBe("error");
  });

  it("takes the first value of a repeated param", () => {
    expect(resolveBillingReturn("acme", { credits: ["pending", "error"] })?.status).toBe("pending");
  });

  // Dismissing the notice must not silently reset the period or the segment scope.
  it("drops only the credits param from the dismiss href", () => {
    const r = resolveBillingReturn("acme", { credits: "pending", range: "90d", segment: "s1" });
    expect(r?.dismissHref).toBe("/org/acme?range=90d&segment=s1");
  });

  it("falls back to the bare org root when nothing else is set", () => {
    expect(resolveBillingReturn("acme", { credits: "error" })?.dismissHref).toBe("/org/acme");
  });

  it("encodes the slug", () => {
    expect(resolveBillingReturn("a b", { credits: "error" })?.dismissHref).toBe("/org/a%20b");
  });
});
