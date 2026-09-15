// The delivery vocabulary. Small, and worth pinning for one reason: `normalizeDelivery` is the only
// thing standing between a wire string and a mode that writes into the operator's working copy, and
// its contract is "an unknown value is null, never a guess".

import { describe, expect, it } from "vitest";
import { DELIVERY_HINTS, DELIVERY_LABELS, LOOP_DELIVERIES, deliveryOf, deliveryTag, normalizeDelivery } from "./delivery-options";

describe("normalizeDelivery", () => {
  it("accepts exactly the three modes", () => {
    expect(normalizeDelivery("branch")).toBe("branch");
    expect(normalizeDelivery("land")).toBe("land");
    expect(normalizeDelivery("pr")).toBe("pr");
  });

  it("is null for anything else — never a guess", () => {
    for (const bad of ["", " land", "LAND", "merge", "Branch", "pull-request", 1, null, undefined, {}, ["land"], true]) {
      expect(normalizeDelivery(bad)).toBeNull();
    }
  });

  it("never promotes an unknown value to a mode that touches the working copy", () => {
    // The regression this forbids: a fallback of `land` (or `pr`) would mean a stale tab, a typo or a
    // hand-rolled request could merge into somebody's checkout.
    for (const bad of ["lands", "landing", "LAND", "pr ", "true"]) expect(deliveryOf(bad as unknown as string)).toBe("branch");
  });
});

describe("deliveryOf", () => {
  it("floors null/unset to branch — what every run written before the column did", () => {
    expect(deliveryOf(null)).toBe("branch");
    expect(deliveryOf(undefined)).toBe("branch");
  });

  it("passes the three modes through", () => {
    for (const d of LOOP_DELIVERIES) expect(deliveryOf(d)).toBe(d);
  });
});

describe("deliveryTag", () => {
  it("says nothing for the default — a tag on every column would say nothing", () => {
    expect(deliveryTag(null)).toBeNull();
    expect(deliveryTag("branch")).toBeNull();
    expect(deliveryTag("nonsense")).toBeNull();
  });

  it("names the two modes that did something beyond the branch", () => {
    expect(deliveryTag("land")).toBe("landed");
    expect(deliveryTag("pr")).toBe("PR");
  });
});

describe("labels", () => {
  it("covers every mode, and describes each in the operator's terms rather than git's", () => {
    for (const d of LOOP_DELIVERIES) {
      expect(DELIVERY_LABELS[d]).toBeTruthy();
      expect(DELIVERY_HINTS[d]).toBeTruthy();
    }
    // The one label that must be unambiguous: `land` writes to a real working copy, and the picker is
    // where the operator finds that out.
    expect(DELIVERY_LABELS.land.toLowerCase()).toContain("my current branch");
    expect(DELIVERY_HINTS.land).toContain("fast-forward only");
  });
});
