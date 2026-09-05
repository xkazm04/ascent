// The low-balance boundary + preference normalization — the pure half of the "auto-recharge" item.
//
// Three things these tests exist to hold:
//   1. NOTHING fires when the feature is off. `enabled: false` must reproduce the exact paused/covered/ok
//      behavior the popover had before the feature existed — an org that never opts in sees no change.
//   2. The warning is reached at the RIGHT boundary: inclusive at the threshold, and only while the
//      balance is still POSITIVE (at 0 the harder paused/covered states must win, since they say more).
//   3. A stored preference round-trips through normalizeAutoRecharge, including the audit-meta blob that
//      carries extra keys (`_sig`) and a legacy/hand-edited row that must degrade to OFF, never to ON.

import { describe, it, expect } from "vitest";
import {
  creditPressure,
  DEFAULT_AUTO_RECHARGE,
  DEFAULT_LOW_BALANCE_THRESHOLD,
  MAX_LOW_BALANCE_THRESHOLD,
  normalizeAutoRecharge,
  AUTO_RECHARGE_CHARGES_AUTOMATICALLY,
  type AutoRechargePref,
} from "./CreditsControl.autorecharge";

const on = (threshold: number): AutoRechargePref => ({ enabled: true, threshold, packProductId: null });
const off = DEFAULT_AUTO_RECHARGE;

describe("creditPressure — feature OFF changes nothing", () => {
  it("never returns 'low' when the preference is disabled, however small the balance", () => {
    for (const balance of [1, 2, 3, 5, 10, 50]) {
      expect(creditPressure({ balance, allowanceRemaining: 0, pref: off })).toBe("ok");
    }
  });

  it("reproduces the pre-feature paused / covered / ok states verbatim", () => {
    expect(creditPressure({ balance: 0, allowanceRemaining: 0, pref: off })).toBe("paused");
    expect(creditPressure({ balance: 0, allowanceRemaining: 4, pref: off })).toBe("covered");
    expect(creditPressure({ balance: 12, allowanceRemaining: 0, pref: off })).toBe("ok");
  });

  it("a stored threshold is inert while enabled is false (the toggle, not the number, is the switch)", () => {
    const disabledButConfigured: AutoRechargePref = { enabled: false, threshold: 500, packProductId: "prod_x" };
    expect(creditPressure({ balance: 3, allowanceRemaining: 0, pref: disabledButConfigured })).toBe("ok");
  });
});

describe("creditPressure — the low-balance boundary", () => {
  it("fires ON the threshold and below, not above it", () => {
    expect(creditPressure({ balance: 6, allowanceRemaining: 0, pref: on(5) })).toBe("ok");
    expect(creditPressure({ balance: 5, allowanceRemaining: 0, pref: on(5) })).toBe("low"); // inclusive
    expect(creditPressure({ balance: 1, allowanceRemaining: 0, pref: on(5) })).toBe("low");
  });

  it("yields to the harder states at zero — 'low' requires a POSITIVE balance", () => {
    expect(creditPressure({ balance: 0, allowanceRemaining: 0, pref: on(5) })).toBe("paused");
    expect(creditPressure({ balance: 0, allowanceRemaining: 3, pref: on(5) })).toBe("covered");
  });

  it("is independent of the monthly allowance while the balance is positive", () => {
    // The allowance only decides paused vs covered at zero; it must not suppress the pre-emptive warning.
    expect(creditPressure({ balance: 2, allowanceRemaining: 99, pref: on(5) })).toBe("low");
  });

  it("treats a negative allowance as zero (defensive: the API can only send >= 0)", () => {
    expect(creditPressure({ balance: 0, allowanceRemaining: -1, pref: on(5) })).toBe("paused");
  });
});

describe("normalizeAutoRecharge — the stored preference round-trips", () => {
  it("round-trips an enabled preference through the audit-meta shape (extra keys ignored)", () => {
    const saved: AutoRechargePref = { enabled: true, threshold: 25, packProductId: "prod_500" };
    // What the audit row actually holds: the preference plus the integrity signature folded in on write.
    const meta = { ...saved, _sig: "abc123", extra: "ignored" };
    expect(normalizeAutoRecharge(meta)).toEqual(saved);
    // And re-normalizing its own output is a fixed point.
    expect(normalizeAutoRecharge(normalizeAutoRecharge(meta))).toEqual(saved);
  });

  it("defaults to OFF for anything unusable — a broken row must never invent a warning", () => {
    for (const bad of [null, undefined, "nope", 7, [], {}]) {
      expect(normalizeAutoRecharge(bad)).toEqual(DEFAULT_AUTO_RECHARGE);
      expect(normalizeAutoRecharge(bad).enabled).toBe(false);
    }
  });

  it("only `enabled === true` enables — truthy strings/numbers do not", () => {
    expect(normalizeAutoRecharge({ enabled: "true", threshold: 5 }).enabled).toBe(false);
    expect(normalizeAutoRecharge({ enabled: 1, threshold: 5 }).enabled).toBe(false);
    expect(normalizeAutoRecharge({ enabled: true, threshold: 5 }).enabled).toBe(true);
  });

  it("clamps a threshold into range and falls back to the default when absent/non-numeric", () => {
    expect(normalizeAutoRecharge({ enabled: true, threshold: 0 }).threshold).toBe(1);
    expect(normalizeAutoRecharge({ enabled: true, threshold: -40 }).threshold).toBe(1);
    expect(normalizeAutoRecharge({ enabled: true, threshold: 1e9 }).threshold).toBe(MAX_LOW_BALANCE_THRESHOLD);
    expect(normalizeAutoRecharge({ enabled: true, threshold: 7.9 }).threshold).toBe(7);
    expect(normalizeAutoRecharge({ enabled: true }).threshold).toBe(DEFAULT_LOW_BALANCE_THRESHOLD);
    expect(normalizeAutoRecharge({ enabled: true, threshold: "5" }).threshold).toBe(DEFAULT_LOW_BALANCE_THRESHOLD);
    expect(normalizeAutoRecharge({ enabled: true, threshold: Number.NaN }).threshold).toBe(
      DEFAULT_LOW_BALANCE_THRESHOLD,
    );
  });

  it("keeps a pack id only when it is a non-blank string", () => {
    expect(normalizeAutoRecharge({ packProductId: "  prod_a  " }).packProductId).toBe("prod_a");
    expect(normalizeAutoRecharge({ packProductId: "   " }).packProductId).toBeNull();
    expect(normalizeAutoRecharge({ packProductId: 42 }).packProductId).toBeNull();
  });
});

describe("honesty flag", () => {
  it("declares that nothing charges automatically — no stored payment method exists in this integration", () => {
    // If this ever flips to true, the UI copy in CreditsControl.autorechargeUi.tsx starts promising an
    // automatic purchase; that must only happen alongside a real off-session charge path.
    expect(AUTO_RECHARGE_CHARGES_AUTOMATICALLY).toBe(false);
  });
});
