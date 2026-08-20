import { afterEach, describe, it, expect, vi } from "vitest";
import {
  retentionCutoff,
  planFeatures,
  planAllows,
  planAllowsByom,
  planAllowsMemory,
  planAllowsSkillsLibrary,
  PLAN_CAPABILITIES,
  PLAN_CAPABILITY_ORDER,
  type PlanCapability,
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

// ---------------------------------------------------------------------------------------------
// The capability model (item 15). Capabilities used to be five hand-written predicates each
// re-opening the tier vocabulary inline, with the pricing card's bullets typed as prose no gate
// read — two sources that agreed only by hand. They are one table now. The hazard of that
// conversion is TRANSCRIPTION: one flag wrong on one tier silently grants or removes a paid
// capability for every customer on it. This block pins the matrix as it stood before the change,
// value by value, so the conversion is checkable rather than trusted.
// ---------------------------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The entitlement matrix, written out longhand ON PURPOSE — deriving it from PLAN_CAPABILITIES
 *  would just assert the table equals itself. Rows are capabilities, columns free/pro/team/custom. */
const EXPECTED: Record<PlanCapability, Record<string, boolean>> = {
  whiteLabel: { free: false, pro: false, team: true, enterprise: true },
  skillsLibrary: { free: false, pro: false, team: true, enterprise: true },
  memory: { free: false, pro: false, team: true, enterprise: true },
  byom: { free: false, pro: false, team: true, enterprise: true },
  pdfExport: { free: false, pro: true, team: true, enterprise: true },
};

describe("capability gates — the matrix, unchanged by the move to a table", () => {
  it.each(Object.keys(EXPECTED) as PlanCapability[])("%s matches the pre-conversion tiers", (cap) => {
    for (const [plan, allowed] of Object.entries(EXPECTED[cap])) {
      expect(planAllows(cap, plan), `${cap} @ ${plan}`).toBe(allowed);
    }
  });

  it("covers every capability in the model — a new one cannot be added without a pinned row", () => {
    expect(PLAN_CAPABILITY_ORDER.slice().sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("the named gates are aliases of the same lookup, not a second opinion", () => {
    for (const plan of PLAN_ORDER) {
      expect(planAllowsByom(plan)).toBe(planAllows("byom", plan));
      expect(planAllowsMemory(plan)).toBe(planAllows("memory", plan));
      expect(planAllowsSkillsLibrary(plan)).toBe(planAllows("skillsLibrary", plan));
    }
  });
});

// The two unknowns have OPPOSITE safe defaults and must not collapse into one rule. An unknown TIER
// floors to free (under-granting is recoverable; over-granting hands out paid capability silently).
// An unknown TENANT is refused rather than floored — that half lives in entitlement.ts, where the
// org's existence is actually known, and is pinned in entitlement.test.ts.
describe("an unrecognised tier floors to free, and free grants nothing gated", () => {
  it.each(["bogus", "", "TEAM", "team ", "enterprise-plus"])("%o is treated as free", (plan) => {
    for (const cap of PLAN_CAPABILITY_ORDER) expect(planAllows(cap, plan), cap).toBe(planAllows(cap, "free"));
  });

  it("null/undefined float down to free too, never up", () => {
    for (const cap of PLAN_CAPABILITY_ORDER) {
      expect(planAllows(cap, null), cap).toBe(false);
      expect(planAllows(cap, undefined), cap).toBe(false);
    }
  });
});

// The self-hosted short-circuit lives in exactly one place now, which is what makes this test able to
// enumerate the MODEL rather than a hand-maintained list of predicates: a capability added tomorrow is
// covered here the moment it is declared. (src/lib/self-host.test.ts pins the same promise through the
// five named gates; this is the version that cannot go stale.)
describe("self-hosted: the one gate short-circuits every capability, present and future", () => {
  it.each(PLAN_CAPABILITY_ORDER)("%s is open on a self-hosted deployment", (cap) => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    expect(planAllows(cap, "free")).toBe(true);
    expect(planAllows(cap, null)).toBe(true);
    expect(planAllows(cap, "nonsense-plan")).toBe(true);
  });

  it.each(PLAN_CAPABILITY_ORDER)("%s is still gated in cloud mode (the paired negative)", (cap) => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    expect(planAllows(cap, "free")).toBe(false);
  });
});

// What the page sells and what the gate enforces are now one source. These assert the JOIN, i.e. that
// the derivation actually reached the card: a buyer reading a bullet is reading the gate.
describe("plan cards advertise exactly the capabilities their tier is gated for", () => {
  it("every capability is sold on the card of the tier that first includes it", () => {
    for (const cap of PLAN_CAPABILITY_ORDER) {
      const meta = PLAN_CAPABILITIES[cap];
      expect(PLAN_FEATURES[meta.minPlan].features, `${cap} on ${meta.minPlan}`).toContain(meta.label);
    }
  });

  it("no card sells a capability its tier is refused", () => {
    for (const plan of PLAN_ORDER) {
      for (const cap of PLAN_CAPABILITY_ORDER) {
        const sold = PLAN_FEATURES[plan].features.includes(PLAN_CAPABILITIES[cap].label);
        if (sold) expect(planAllows(cap, plan), `${plan} sells ${cap}`).toBe(true);
      }
    }
  });

  it("a tier's `capabilities` array is what the gate reads, and is cumulative up the ladder", () => {
    expect(PLAN_FEATURES.free.capabilities).toEqual([]);
    expect(PLAN_FEATURES.pro.capabilities).toEqual(["pdfExport"]);
    expect(PLAN_FEATURES.team.capabilities).toEqual(["whiteLabel", "skillsLibrary", "memory", "byom", "pdfExport"]);
    expect(PLAN_FEATURES.enterprise.capabilities).toEqual(PLAN_FEATURES.team.capabilities);
  });

  it("keeps the ungated selling points as prose — they are promises, not entitlements", () => {
    // Deliberately NOT capabilities: nothing in the codebase refuses these (see the "advertises but
    // nothing enforces" table in docs/features/billing/billing.md). Pinned so a future edit doesn't
    // quietly promote one into the gated union without adding the call site that enforces it.
    expect(PLAN_FEATURES.pro.features).toContain("Org fleet dashboard");
    expect(PLAN_FEATURES.team.features).toContain("Segments + comparisons");
  });
});
