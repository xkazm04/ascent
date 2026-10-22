// Per-repo report-back credential names, and the five honest states a provisioned row can be in.

import { describe, it, expect } from "vitest";
import {
  LEGACY_TOKEN_NAME,
  TOKEN_NAME_MAX,
  canReport,
  failureReason,
  provisionRecordOf,
  reportBackState,
  tokenNameFor,
} from "./reportback-credential";

describe("tokenNameFor", () => {
  it("gives two repos two different names, neither the legacy shared one", () => {
    const one = tokenNameFor("a/one");
    const two = tokenNameFor("a/two");
    expect(one).not.toBe(two);
    expect(one).not.toBe(LEGACY_TOKEN_NAME);
    expect(two).not.toBe(LEGACY_TOKEN_NAME);
  });

  it("is stable and case-insensitive", () => {
    expect(tokenNameFor("Acme/App")).toBe(tokenNameFor("acme/app"));
  });

  it("a 140-char owner/repo fits the column, and two names sharing their first 80 chars still differ", () => {
    const stem = `acme/${"x".repeat(120)}`;
    const a = tokenNameFor(`${stem}-alpha-0000000000`);
    const b = tokenNameFor(`${stem}-beta-00000000000`);
    expect(`${stem}-alpha-0000000000`.length).toBeGreaterThanOrEqual(140);
    expect(a.length).toBeLessThanOrEqual(TOKEN_NAME_MAX);
    expect(b.length).toBeLessThanOrEqual(TOKEN_NAME_MAX);
    expect(a.slice(0, 60)).toBe(b.slice(0, 60));
    expect(a).not.toBe(b);
  });
});

describe("failureReason", () => {
  it("a 403 is a missing permission; anything else is a write failure", () => {
    expect(failureReason(403)).toBe("missing-permission");
    expect(failureReason(500)).toBe("write-failed");
    expect(failureReason(undefined)).toBe("write-failed");
  });
});

describe("reportBackState", () => {
  const live = new Set(["askl_LIVE000"]);
  const rec = (over: Partial<ReturnType<typeof provisionRecordOf>> = {}) => ({
    ok: true,
    tokenPrefix: "askl_LIVE000",
    tokenName: tokenNameFor("a/one"),
    reason: null,
    ...over,
  });

  it("no provision row is none", () => {
    expect(reportBackState(null, live)).toEqual({ state: "none" });
  });

  it("a recorded ok:false is failed, with its reason class", () => {
    expect(reportBackState(rec({ ok: false, reason: "missing-permission" }), live)).toEqual({
      state: "failed",
      reason: "missing-permission",
    });
    expect(reportBackState(rec({ ok: false }), live)).toEqual({ state: "failed", reason: "write-failed" });
  });

  it("a recorded prefix that is no longer live is credential-revoked", () => {
    expect(reportBackState(rec({ tokenPrefix: "askl_GONE000" }), live).state).toBe("credential-revoked");
  });

  it("a live row under the legacy shared name (or no name at all) is legacy-shared", () => {
    expect(reportBackState(rec({ tokenName: LEGACY_TOKEN_NAME }), live).state).toBe("legacy-shared");
    expect(reportBackState(rec({ tokenName: null }), live).state).toBe("legacy-shared");
  });

  it("a live per-repo credential is live, and only live + legacy-shared can report", () => {
    expect(reportBackState(rec(), live)).toEqual({ state: "live" });
    expect(canReport({ state: "live" })).toBe(true);
    expect(canReport({ state: "legacy-shared" })).toBe(true);
    expect(canReport({ state: "credential-revoked" })).toBe(false);
    expect(canReport({ state: "failed" })).toBe(false);
  });
});

describe("provisionRecordOf", () => {
  it("reads an older meta with no ok, name or reason as a legacy success", () => {
    expect(provisionRecordOf({ repo: "a/one", tokenPrefix: "askl_X" })).toEqual({
      ok: true,
      tokenPrefix: "askl_X",
      tokenName: null,
      reason: null,
    });
  });
});
