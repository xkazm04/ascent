import { describe, it, expect } from "vitest";
import {
  retentionCutoff,
  planFeatures,
  planAllowsWhiteLabel,
  planAllowsPdfExport,
  planPriceLabel,
  planScanLine,
  scanAllowance,
  decideScanCharge,
  PLAN_FEATURES,
  PLAN_ORDER,
  UNLIMITED_PLAN_LABEL,
} from "./plans";

const NOW = Date.UTC(2026, 5, 20); // fixed clock so the cutoff math is deterministic
const DAY = 86_400_000;

describe("retentionCutoff (non-destructive read floor)", () => {
  it("clamps Free to 30 days back", () => {
    expect(retentionCutoff("free", NOW)).toEqual(new Date(NOW - 30 * DAY));
  });

  it("clamps Starter to 180 and Team to 365 days back", () => {
    expect(retentionCutoff("pro", NOW)).toEqual(new Date(NOW - 180 * DAY));
    expect(retentionCutoff("team", NOW)).toEqual(new Date(NOW - 365 * DAY));
  });

  it("returns null (unlimited, no floor) for the bespoke tier", () => {
    expect(PLAN_FEATURES.enterprise.retentionDays).toBeNull();
    expect(retentionCutoff("enterprise", NOW)).toBeNull();
  });

  it("treats unknown/blank plans as Free", () => {
    expect(retentionCutoff(null, NOW)).toEqual(new Date(NOW - 30 * DAY));
    expect(retentionCutoff("bogus", NOW)).toEqual(new Date(NOW - planFeatures("free").retentionDays! * DAY));
  });
});

describe("planAllowsWhiteLabel — Team and up", () => {
  it("allows Team and the bespoke tier, denies Free/Starter/unknown", () => {
    expect(planAllowsWhiteLabel("team")).toBe(true);
    expect(planAllowsWhiteLabel("enterprise")).toBe(true);
    expect(planAllowsWhiteLabel("pro")).toBe(false);
    expect(planAllowsWhiteLabel("free")).toBe(false);
    expect(planAllowsWhiteLabel(null)).toBe(false);
    expect(planAllowsWhiteLabel("bogus")).toBe(false);
  });
});

describe("planAllowsPdfExport — the lowest paid tier and up (g1-02)", () => {
  it("allows `pro`/Starter, Team, and the bespoke tier, denies Free/unknown", () => {
    expect(planAllowsPdfExport("pro")).toBe(true);
    expect(planAllowsPdfExport("team")).toBe(true);
    expect(planAllowsPdfExport("enterprise")).toBe(true);
    expect(planAllowsPdfExport("free")).toBe(false);
    expect(planAllowsPdfExport(null)).toBe(false);
    expect(planAllowsPdfExport("bogus")).toBe(false);
  });
});

describe("scanAllowance — monthly metered-scan allowance per tier", () => {
  it("is 20 / 50 / 150, and null (unlimited) for the bespoke tier", () => {
    // Free was 5 until 2026-08-19. It was raised with the open-source transition: the Free tier now
    // competes with an unlimited, ungated `git clone`, so five scans a month was an argument FOR
    // self-hosting rather than a trial of the cloud. See the note on PLAN_FEATURES.free.
    expect(scanAllowance("free")).toBe(20);
    expect(scanAllowance("pro")).toBe(50);
    expect(scanAllowance("team")).toBe(150);
    expect(scanAllowance("enterprise")).toBeNull();
    expect(scanAllowance(null)).toBe(20); // unknown → free
  });
});

describe("planPriceLabel — subscription display prices", () => {
  it("Free is $0, Starter $5/mo, Team $10/mo, the bespoke tier Flexible", () => {
    expect(planPriceLabel("free")).toEqual({ amount: "$0", cadence: "free forever" });
    expect(planPriceLabel("pro")).toEqual({ amount: "$5", cadence: "/ month" });
    expect(planPriceLabel("team")).toEqual({ amount: "$10", cadence: "/ month" });
    // "Custom" is the tier's NAME now, so it can't also be its price — the headline says what the
    // price actually is (flexible), not the word already printed above it.
    expect(planPriceLabel("enterprise")).toEqual({ amount: "Flexible", cadence: "scoped with you" });
  });

  it("Starter and Team are subscriptions; Free is free; the bespoke tier is custom-billed", () => {
    expect(PLAN_FEATURES.pro.billing).toBe("subscription");
    expect(PLAN_FEATURES.team.billing).toBe("subscription");
    expect(PLAN_FEATURES.free.billing).toBe("free");
    expect(PLAN_FEATURES.enterprise.billing).toBe("custom");
  });
});

describe("decideScanCharge — hybrid: allowance, then a credit, then denied", () => {
  it("unlimited is always free, ignoring usage/balance", () => {
    expect(decideScanCharge({ unlimited: true, allowance: 0, usageThisMonth: 9999, balance: 0 })).toBe("unlimited");
  });
  it("is free while under the monthly allowance", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 0, balance: 0 })).toBe("allowance");
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 9, balance: 0 })).toBe("allowance");
  });
  it("draws a credit once the allowance is spent (and credits remain)", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 10, balance: 3 })).toBe("credit");
  });
  it("is denied (the 402) when the allowance is spent AND there are no credits", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 10, balance: 0 })).toBe("denied");
  });
  it("a zero allowance falls straight to credits / denied", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 0, usageThisMonth: 0, balance: 1 })).toBe("credit");
    expect(decideScanCharge({ unlimited: false, allowance: 0, usageThisMonth: 0, balance: 0 })).toBe("denied");
  });
});

describe("marketing copy matches the metering engine (checkout-plans-polar 07-16 #5)", () => {
  // The engine (src/lib/db/credits.ts, decideScanCharge callers) meters only PRIVATE (org) scans;
  // public scans are free and unmetered. The plan cards' copy must never re-claim the old
  // "public or private" allowance model — the CreditMatrixLedger on the same /pricing page states
  // the opposite, and a visitor comparing the two blocks would see a direct contradiction.
  it("no plan blurb or feature line claims public scans draw the allowance", () => {
    for (const p of Object.values(PLAN_FEATURES)) {
      for (const text of [p.blurb, ...p.features]) {
        expect(text.toLowerCase()).not.toContain("public or private");
      }
    }
  });
  it("the Free tier pitches the real model: private scans metered, public scans always free", () => {
    expect(PLAN_FEATURES.free.blurb).toMatch(/private scans/i);
    expect(PLAN_FEATURES.free.blurb).toMatch(/public scans are always free/i);
  });
});

// The bespoke tier is stored as `enterprise` and NAMED "Custom" — a display-only rename (the id is
// persisted on Organization.plan and mapped by POLAR_PLAN_PRODUCTS, so it can't move). These pin the
// two halves apart so a future rename can't quietly become a data migration.
describe("tier identity — stored id vs customer-facing label", () => {
  it("keeps the stored ids while the labels read Starter / Custom", () => {
    expect(PLAN_FEATURES.pro.id).toBe("pro");
    expect(PLAN_FEATURES.pro.label).toBe("Starter");
    expect(PLAN_FEATURES.enterprise.id).toBe("enterprise");
    expect(PLAN_FEATURES.enterprise.label).toBe("Custom");
    expect(UNLIMITED_PLAN_LABEL).toBe("Custom");
  });

  // The ids are persisted on Organization.plan and mapped by POLAR_PLAN_PRODUCTS; a rename that moved
  // one would silently orphan every existing row and every configured Polar product.
  it("never lets a relabel move an id — PLAN_ORDER is the stored set", () => {
    expect(PLAN_ORDER).toEqual(["free", "pro", "team", "enterprise"]);
    for (const id of PLAN_ORDER) expect(PLAN_FEATURES[id].id).toBe(id);
  });

  it("describes the bespoke tier by what is ADJUSTABLE, not by a list of unlimited things", () => {
    const bullets = PLAN_FEATURES.enterprise.features.join(" ").toLowerCase();
    for (const area of ["hosting", "scans", "support", "customization", "sso"]) {
      expect(bullets).toContain(area);
    }
    expect(bullets).not.toContain("unlimited");
  });
});

// The card states the monthly scan volume ONCE, in its own typography, from planScanLine — so no plan's
// bullet list may restate it. This is the assertion that keeps the duplication from creeping back.
describe("planScanLine — the single statement of scan volume", () => {
  it("reads the allowance from the model for metered tiers", () => {
    // Short by design — it renders as mono type in a narrow price column, and the longer
    // "… / mo included" wrapped in every cell, stair-stepping each card's hairline rule. The card
    // supplies "Included" as the label above it.
    expect(planScanLine("free")).toBe("20 private scans / mo");
    expect(planScanLine("pro")).toBe("50 private scans / mo");
    expect(planScanLine("team")).toBe("150 private scans / mo");
  });

  it("describes the bespoke tier's volume as negotiated, not unlimited", () => {
    expect(planScanLine("enterprise")).toBe("Scan volume you define");
  });

  it("no plan's feature bullets restate the scan volume", () => {
    for (const id of PLAN_ORDER) {
      for (const bullet of PLAN_FEATURES[id].features) {
        expect(bullet).not.toMatch(/private scans \/ mo|scans \/ month included/i);
      }
    }
  });
});
