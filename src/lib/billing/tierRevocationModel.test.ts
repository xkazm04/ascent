// Pins the one revocation decision every downgrade path asks (subscription.revoked, immediate
// subscription.canceled, full refund of a plan order): a revoke removes only the tier THIS
// subscription conferred. Pure module, no I/O.

import { describe, it, expect } from "vitest";
import {
  ENTITLING_SUB_STATUSES,
  decideTierRevocation,
  planRank,
  subscriptionEntitlesTier,
} from "./tierRevocationModel";

describe("decideTierRevocation - scoped to the granting subscription", () => {
  it("same-tier replacement: a revoke for a subscription that is no longer the grantor is retained", () => {
    const d = decideTierRevocation({
      dyingSubId: "sub_A",
      dyingPlan: "pro",
      current: { plan: "pro", grantingSubId: "sub_B", grantingStatus: "active" },
    });
    expect(d).toEqual({ action: "retain", reason: "replaced", plan: "pro", grantingSubId: "sub_B" });
  });

  it("lower-tier replacement: Team -> Starter via a new subscription survives the old Team revoke", () => {
    const d = decideTierRevocation({
      dyingSubId: "sub_A",
      dyingPlan: "team",
      current: { plan: "pro", grantingSubId: "sub_B", grantingStatus: "active" },
    });
    expect(d.action).toBe("retain");
    expect(d.reason).toBe("replaced");
  });

  it("guard: the dying subscription IS the grantor -> downgrade", () => {
    const d = decideTierRevocation({
      dyingSubId: "sub_A",
      dyingPlan: "pro",
      current: { plan: "pro", grantingSubId: "sub_A" },
    });
    expect(d.action).toBe("downgrade");
  });

  it("guard: grantingSubId null falls back to the rank guard (downgrade when current <= dying)", () => {
    for (const plan of ["pro", "free"]) {
      const d = decideTierRevocation({ dyingSubId: "sub_A", dyingPlan: "pro", current: { plan, grantingSubId: null } });
      expect(d.action).toBe("downgrade");
      expect(d.reason).toBe("rank");
    }
  });

  it("guard: grantingSubId null falls back to the rank guard (retain when current outranks dying)", () => {
    const d = decideTierRevocation({ dyingSubId: "sub_A", dyingPlan: "pro", current: { plan: "team", grantingSubId: null } });
    expect(d).toEqual({ action: "retain", reason: "override", plan: "team", grantingSubId: null });
  });

  it("guard: manual enterprise override with no Subscription row is retained", () => {
    const d = decideTierRevocation({ dyingSubId: "sub_A", dyingPlan: "pro", current: { plan: "enterprise", grantingSubId: null } });
    expect(d.action).toBe("retain");
    expect(d.reason).toBe("override");
  });

  it("the grantor rule still keeps a manual override above the granting subscription", () => {
    const d = decideTierRevocation({
      dyingSubId: "sub_A",
      dyingPlan: "pro",
      current: { plan: "enterprise", grantingSubId: "sub_A", grantingStatus: "active" },
    });
    expect(d.action).toBe("retain");
    expect(d.reason).toBe("override");
  });

  it("an INACTIVE Subscription row is not a live grantor: rank fallback decides", () => {
    const d = decideTierRevocation({
      dyingSubId: "sub_A",
      dyingPlan: "pro",
      current: { plan: "pro", grantingSubId: "sub_B", grantingStatus: "inactive" },
    });
    expect(d.action).toBe("downgrade");
    expect(d.reason).toBe("rank");
  });

  it("a dying order with no subscription (one-time plan order) uses the rank guard", () => {
    const d = decideTierRevocation({
      dyingSubId: null,
      dyingPlan: "pro",
      current: { plan: "pro", grantingSubId: "sub_B", grantingStatus: "active" },
    });
    expect(d.action).toBe("downgrade");
    expect(d.reason).toBe("rank");
  });
});

describe("status vocabulary (moved verbatim from the webhook route)", () => {
  it("entitling statuses are the closed set active / trialing / past_due", () => {
    expect([...ENTITLING_SUB_STATUSES].sort()).toEqual(["active", "past_due", "trialing"]);
  });

  it("subscriptionEntitlesTier: one-time order entitles, ended or non-entitling status does not", () => {
    expect(subscriptionEntitlesTier(null)).toBe(true);
    expect(subscriptionEntitlesTier({ status: "active", endedAt: null })).toBe(true);
    expect(subscriptionEntitlesTier({ status: "active", endedAt: new Date() })).toBe(false);
    expect(subscriptionEntitlesTier({ status: "canceled", endedAt: null })).toBe(false);
  });

  it("planRank ranks unknown/blank as free", () => {
    expect(planRank(null)).toBe(0);
    expect(planRank("nonsense")).toBe(0);
    expect(planRank("team")).toBeGreaterThan(planRank("pro"));
  });
});
