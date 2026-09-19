// ADR-0001 T2 — the per-org credit ceiling as a table. Pure: no Prisma, no env, no clock.
//
// What it pins:
//   • the ceiling binds the org the balance does not (an unlimited plan);
//   • the ceiling is judged before the balance, because credits cannot lift it;
//   • a run is decided whole — the cost is lanes × reservation, never "the first lane fits";
//   • an unreadable plan gets no hosted spend, not the richest tier's.

import { describe, expect, it } from "vitest";
import {
  HOSTED_LANE_CREDITS,
  HOSTED_MONTHLY_CEILING_CREDITS,
  decideHostedCharge,
  hostedMonthStart,
  hostedMonthlyCeiling,
  withinCeilingAtDispatch,
  type HostedChargeFacts,
} from "./hosted-ceiling";

const L = HOSTED_LANE_CREDITS;
const base: HostedChargeFacts = { lanes: 2, unlimited: false, balance: 1_000, spentThisMonth: 0, ceiling: 100 };

describe("decideHostedCharge", () => {
  it("charges lanes × the reservation and debits it from a metered plan", () => {
    expect(decideHostedCharge(base)).toEqual({ ok: true, cost: 2 * L, debit: 2 * L });
  });

  it("refuses a run whose cost would cross the ceiling, even when the first lane would fit", () => {
    expect(decideHostedCharge({ ...base, spentThisMonth: 100 - L })).toEqual({ ok: false, cost: 2 * L, block: "over-ceiling" });
  });

  it("allows a run that lands exactly on the ceiling", () => {
    expect(decideHostedCharge({ ...base, spentThisMonth: 100 - 2 * L })).toMatchObject({ ok: true });
  });

  it("refuses a balance that does not cover the whole run", () => {
    expect(decideHostedCharge({ ...base, balance: 2 * L - 1 })).toEqual({ ok: false, cost: 2 * L, block: "no-credit" });
  });

  it("binds an UNLIMITED plan by the ceiling, and never debits it", () => {
    expect(decideHostedCharge({ ...base, unlimited: true, balance: 0 })).toEqual({ ok: true, cost: 2 * L, debit: 0 });
    expect(decideHostedCharge({ ...base, unlimited: true, balance: 0, spentThisMonth: 100 })).toMatchObject({ ok: false, block: "over-ceiling" });
  });

  it("names the ceiling before the balance when both are shut", () => {
    expect(decideHostedCharge({ ...base, balance: 0, spentThisMonth: 100 })).toMatchObject({ block: "over-ceiling" });
  });

  it("applies no ceiling when there is none (self-hosted)", () => {
    expect(decideHostedCharge({ ...base, unlimited: true, ceiling: null, spentThisMonth: 1e9 })).toMatchObject({ ok: true, debit: 0 });
  });

  it("refuses every hosted lane on a zero ceiling", () => {
    expect(decideHostedCharge({ ...base, lanes: 1, ceiling: 0 })).toMatchObject({ ok: false, block: "over-ceiling" });
  });
});

describe("hostedMonthlyCeiling", () => {
  it("reads the plan's row on a cloud deployment", () => {
    expect(hostedMonthlyCeiling("team", false)).toBe(HOSTED_MONTHLY_CEILING_CREDITS.team);
    expect(hostedMonthlyCeiling("enterprise", false)).toBe(HOSTED_MONTHLY_CEILING_CREDITS.enterprise);
  });

  it("gives the plans that are not entitled to hosted runs no hosted spend", () => {
    expect(hostedMonthlyCeiling("free", false)).toBe(0);
    expect(hostedMonthlyCeiling("pro", false)).toBe(0);
  });

  it("reads an unknown or missing plan as no hosted spend", () => {
    expect(hostedMonthlyCeiling("platinum", false)).toBe(0);
    expect(hostedMonthlyCeiling(null, false)).toBe(0);
  });

  it("has no ceiling on a self-hosted deployment", () => {
    expect(hostedMonthlyCeiling("free", true)).toBeNull();
  });
});

describe("withinCeilingAtDispatch", () => {
  // The lane being dispatched was already counted when it was armed, so "at the ceiling" is still in.
  it("passes spend at the ceiling and refuses spend past it", () => {
    expect(withinCeilingAtDispatch(100, 100)).toBe(true);
    expect(withinCeilingAtDispatch(101, 100)).toBe(false);
    expect(withinCeilingAtDispatch(1e9, null)).toBe(true);
  });
});

describe("hostedMonthStart", () => {
  it("is the first instant of the UTC month", () => {
    expect(hostedMonthStart(new Date("2026-09-30T23:59:59.999Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
