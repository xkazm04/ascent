import { describe, expect, it } from "vitest";
import {
  parseOrgRetentionBody,
  parseRetentionBool,
  parseRetentionInt,
  retentionFloorViolations,
  RETENTION_MIN_AUDIT_DAYS,
  RETENTION_MIN_SCANS_PER_REPO,
} from "./retention-policy";

describe("parseRetentionInt", () => {
  it("treats null and blank as inherit, refuses floats and negatives", () => {
    expect(parseRetentionInt(undefined)).toBeUndefined();
    expect(parseRetentionInt(null)).toBeNull();
    expect(parseRetentionInt("")).toBeNull();
    expect(parseRetentionInt("  ")).toBeNull();
    expect(parseRetentionInt(0)).toBe(0);
    expect(parseRetentionInt("12")).toBe(12);
    expect(parseRetentionInt(5.5)).toBe(false);
    expect(parseRetentionInt(-1)).toBe(false);
    expect(parseRetentionInt("nope")).toBe(false);
  });
});

describe("parseRetentionBool", () => {
  it("accepts boolean or inherit, not strings", () => {
    expect(parseRetentionBool(undefined)).toBeUndefined();
    expect(parseRetentionBool(null)).toBeNull();
    expect(parseRetentionBool(true)).toBe(true);
    expect(parseRetentionBool(false)).toBe(false); // legal "off", not the invalid sentinel
    expect(parseRetentionBool("true")).toBe("invalid");
  });
});

describe("retentionFloorViolations", () => {
  it("never floors inherit or unlimited, refuses configured-but-below-floor", () => {
    expect(retentionFloorViolations({ retentionMaxScans: null, retentionAuditDays: null })).toEqual([]);
    expect(retentionFloorViolations({ retentionMaxScans: 0, retentionAuditDays: 0 })).toEqual([]);
    expect(
      retentionFloorViolations({
        retentionMaxScans: RETENTION_MIN_SCANS_PER_REPO,
        retentionAuditDays: RETENTION_MIN_AUDIT_DAYS,
      }),
    ).toEqual([]);
    expect(retentionFloorViolations({ retentionMaxScans: 1, retentionAuditDays: 3 }).join(" ")).toMatch(
      /retentionMaxScans=1/,
    );
  });
});

describe("parseOrgRetentionBody", () => {
  it("requires all four keys and refuses a sub-floor write", () => {
    expect(parseOrgRetentionBody({})).toMatchObject({ ok: false });
    expect(
      parseOrgRetentionBody({
        retentionMaxScans: 1,
        retentionAuditDays: 30,
        retentionCompact: true,
        retentionDigestMonths: 12,
      }),
    ).toMatchObject({ ok: false, belowFloor: true });
    expect(
      parseOrgRetentionBody({
        retentionMaxScans: 0,
        retentionAuditDays: null,
        retentionCompact: false,
        retentionDigestMonths: 0,
      }),
    ).toEqual({
      ok: true,
      stored: {
        retentionMaxScans: 0,
        retentionAuditDays: null,
        retentionCompact: false,
        retentionDigestMonths: 0,
      },
    });
  });
});
