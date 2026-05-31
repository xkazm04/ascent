import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clampBatchSize,
  envRetentionDefaults,
  resolveRetention,
  RETENTION_DEFAULT_BATCH_SIZE,
  type RetentionPolicy,
} from "@/lib/db/retention";

const ENV_KEYS = ["RETENTION_MAX_SCANS_PER_REPO", "RETENTION_AUDIT_DAYS", "RETENTION_BATCH_SIZE"] as const;

describe("clampBatchSize", () => {
  it("falls back to the default for null, zero, or negative", () => {
    expect(clampBatchSize(null)).toBe(RETENTION_DEFAULT_BATCH_SIZE);
    expect(clampBatchSize(0)).toBe(RETENTION_DEFAULT_BATCH_SIZE);
    expect(clampBatchSize(-10)).toBe(RETENTION_DEFAULT_BATCH_SIZE);
  });

  it("keeps a valid value and caps oversized ones", () => {
    expect(clampBatchSize(250)).toBe(250);
    expect(clampBatchSize(1_000_000)).toBe(5000);
  });
});

describe("envRetentionDefaults", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to retention disabled (0/0) with the default batch size", () => {
    expect(envRetentionDefaults()).toEqual({
      maxScansPerRepo: 0,
      auditDays: 0,
      batchSize: RETENTION_DEFAULT_BATCH_SIZE,
    });
  });

  it("parses configured values", () => {
    process.env.RETENTION_MAX_SCANS_PER_REPO = "12";
    process.env.RETENTION_AUDIT_DAYS = "90";
    process.env.RETENTION_BATCH_SIZE = "200";
    expect(envRetentionDefaults()).toEqual({ maxScansPerRepo: 12, auditDays: 90, batchSize: 200 });
  });

  it("ignores invalid / negative values and uses the fallbacks", () => {
    process.env.RETENTION_MAX_SCANS_PER_REPO = "not-a-number";
    process.env.RETENTION_AUDIT_DAYS = "-5";
    process.env.RETENTION_BATCH_SIZE = "0";
    expect(envRetentionDefaults()).toEqual({
      maxScansPerRepo: 0,
      auditDays: 0,
      batchSize: RETENTION_DEFAULT_BATCH_SIZE,
    });
  });
});

describe("resolveRetention", () => {
  const defaults: RetentionPolicy = { maxScansPerRepo: 10, auditDays: 30, batchSize: 500 };

  it("inherits the env default when the org override is null", () => {
    expect(resolveRetention(defaults, { retentionMaxScans: null, retentionAuditDays: null })).toEqual({
      maxScansPerRepo: 10,
      auditDays: 30,
      batchSize: 500,
    });
  });

  it("lets a per-org override win over the default", () => {
    expect(resolveRetention(defaults, { retentionMaxScans: 5, retentionAuditDays: 365 })).toEqual({
      maxScansPerRepo: 5,
      auditDays: 365,
      batchSize: 500,
    });
  });

  it("treats an explicit org 0 as unlimited, overriding a non-zero default", () => {
    expect(resolveRetention(defaults, { retentionMaxScans: 0, retentionAuditDays: 0 })).toEqual({
      maxScansPerRepo: 0,
      auditDays: 0,
      batchSize: 500,
    });
  });
});
