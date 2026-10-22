// integrityStripState: the pure mapping from a whole-trail sweep to what the strip says. The rule it
// pins: a partial or unverifiable sweep is NEVER rendered as clean, and `unsigned` is never an alarm.

import { describe, it, expect } from "vitest";
import type { AuditLogEntry } from "@/lib/db";

const EM_DASH = String.fromCharCode(0x2014);
import { appliedQueryFromCsvHref, integrityStripState, type AuditIntegritySummary } from "./auditIntegrityModel";

const sum = (over: Partial<AuditIntegritySummary> = {}): AuditIntegritySummary => ({
  scanned: 4210,
  ok: 4210,
  unsigned: 0,
  tampered: 0,
  noSecret: 0,
  truncated: false,
  tamperedEntries: [],
  cap: 10000,
  ...over,
});
const bad = { id: "t1", integrity: "tampered" } as AuditLogEntry;
const text = (s: ReturnType<typeof integrityStripState>) => `${s.headline} ${s.detail ?? ""}`;

describe("integrityStripState", () => {
  it("all ok -> verified, 'N of N verified', no action", () => {
    const s = integrityStripState(sum());
    expect(s.kind).toBe("verified");
    expect(s.headline).toContain("4,210 of 4,210 verified");
    expect(s.action).toBeUndefined();
  });

  it("any tampered -> tampered, alarm tone, show-tampered action naming the count", () => {
    const s = integrityStripState(sum({ ok: 4020, unsigned: 187, tampered: 3, tamperedEntries: [bad, bad, bad] }));
    expect(s.kind).toBe("tampered");
    expect(s.tone).toBe("alarm");
    expect(s.action).toBe("show-tampered");
    expect(s.headline).toBe("Checked 4,210 entries matching this filter: 4,020 verified, 187 unsigned, 3 tampered");
    expect(s.actionLabel).toBe("Show the 3 tampered");
  });

  it("names the 50-row cap on the show action when more were tampered than returned", () => {
    const s = integrityStripState(sum({ ok: 4130, tampered: 80, tamperedEntries: Array(50).fill(bad) }));
    expect(s.actionLabel).toBe("Show the first 50 of 80 tampered");
  });

  it("truncated -> partial, names the 10,000 cap and that the OLDEST rows were not checked", () => {
    const s = integrityStripState(sum({ scanned: 10000, ok: 10000, truncated: true }));
    expect(s.kind).toBe("partial");
    expect(s.tone).not.toBe("ok");
    expect(text(s)).toContain("10,000");
    expect(text(s).toLowerCase()).toContain("oldest");
    expect(text(s)).not.toMatch(/of 10,000 verified/);
  });

  it("tampered beats partial but still says the check was partial", () => {
    const s = integrityStripState(sum({ scanned: 10000, ok: 9999, tampered: 1, truncated: true, tamperedEntries: [bad] }));
    expect(s.kind).toBe("tampered");
    expect(text(s).toLowerCase()).toContain("oldest");
  });

  it("every row no-secret -> unverifiable, never verified", () => {
    const s = integrityStripState(sum({ ok: 0, noSecret: 4210 }));
    expect(s.kind).toBe("unverifiable");
    expect(text(s)).not.toContain("verified,");
    expect(s.tone).not.toBe("ok");
  });

  it("unsigned > 0 with tampered 0 -> verified-with-unsigned, neutral (never an alarm)", () => {
    const s = integrityStripState(sum({ ok: 4023, unsigned: 187 }));
    expect(s.kind).toBe("verified-with-unsigned");
    expect(s.tone).toBe("neutral");
    expect(s.headline).toBe("Checked 4,210 entries matching this filter: 4,023 verified, 187 unsigned");
  });

  it("no matching rows -> empty, not a clean verdict", () => {
    const s = integrityStripState(sum({ scanned: 0, ok: 0 }));
    expect(s.kind).toBe("empty");
    expect(s.tone).toBe("neutral");
  });

  it("writes no em dash in any state", () => {
    for (const o of [{}, { tampered: 1, tamperedEntries: [bad] }, { truncated: true }, { ok: 0, noSecret: 4210 }, { unsigned: 3 }]) {
      expect(text(integrityStripState(sum(o)))).not.toContain(EM_DASH);
    }
  });
});

describe("appliedQueryFromCsvHref", () => {
  it("recovers the applied filter query the CSV link was built from, minus format=csv", () => {
    expect(appliedQueryFromCsvHref("/api/audit?org=acme&action=scan.created&since=2026-10-01&format=csv")).toBe(
      "org=acme&action=scan.created&since=2026-10-01",
    );
  });
});
