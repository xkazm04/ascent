// The Scan-row codec: one declared table, both halves, round-trip proven (card scan-persist-0).

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Scan } from "@prisma/client";
import type { ScanReport } from "@/lib/types";
import {
  SCAN_COLUMN_EXCEPTIONS,
  SCAN_REPORT_COLUMNS,
  decodeScanColumns,
  encodeScanColumns,
  undecidedColumns,
} from "./scan-row-codec";
import { FIVE_COLUMNS, FIVE_FIELDS } from "./scan-row-codec.test-helpers";

/** A report with EVERY codec-declared field set to a parser-normal value. */
const FULL = {
  ...FIVE_FIELDS,
  prStats: { aiInvolvedRate: 12, tools: [] },
  governance: { branchProtection: true },
  commitActivity: [3, 0, 7],
  techStack: { languages: ["TypeScript"], frameworks: [], roles: ["frontend"], confidence: 0.8 },
  scoreIntegrity: { levers: [] },
  sensorFailures: ["governance"],
  warnings: ["Low coverage"],
} as unknown as ScanReport;

const CODEC_FIELDS = Object.values(SCAN_REPORT_COLUMNS).map((c) => c.field).filter((f) => f !== "passport");

describe("encode/decode round-trip", () => {
  it("decodeScanColumns(encodeScanColumns(report)) equals the report on every declared field", () => {
    const decoded = decodeScanColumns(encodeScanColumns(FULL)) as Record<string, unknown>;
    for (const f of CODEC_FIELDS) expect(decoded[f], f).toEqual((FULL as unknown as Record<string, unknown>)[f]);
  });

  it("encodes the five report columns byte-identically to the former hand-list", () => {
    const enc = encodeScanColumns(FULL);
    for (const [col, s] of Object.entries(FIVE_COLUMNS)) expect(enc[col as keyof typeof enc], col).toBe(s);
  });

  it("a report that never carried a field encodes NULL, and NULL decodes ABSENT for the optional blobs", () => {
    const enc = encodeScanColumns({} as ScanReport);
    for (const v of Object.values(enc)) expect(v).toBeNull();
    const decoded = decodeScanColumns(enc);
    for (const k of Object.keys(FIVE_FIELDS)) expect(k in decoded, k).toBe(false);
  });

  it("a corrupt column decodes absent and never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const enc = { ...encodeScanColumns(FULL), manifestJson: "{not json", practiceShape: "[]" };
    const decoded = decodeScanColumns(enc);
    expect("manifest" in decoded).toBe(false);
    expect("practiceShape" in decoded).toBe(false);
    expect(decoded.guidanceGraph).toEqual(FIVE_FIELDS.guidanceGraph);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("every Scan column has a decode decision", () => {
  it("the Prisma model's scalar columns are each a codec column or a named exception, never both", () => {
    const columns = Object.values(Prisma.ScanScalarFieldEnum) as string[];
    expect(undecidedColumns(columns)).toEqual([]);
    for (const c of Object.keys(SCAN_REPORT_COLUMNS)) {
      expect(columns, c).toContain(c);
      expect(c in SCAN_COLUMN_EXCEPTIONS, c).toBe(false);
    }
    for (const c of Object.keys(SCAN_COLUMN_EXCEPTIONS)) expect(columns, c).toContain(c);
  });

  it("bites: a seeded column with no decode decision is reported", () => {
    expect(undecidedColumns(["manifestJson", "repoId", "freshBlobJson"])).toEqual(["freshBlobJson"]);
  });

  it("an entry with no decode half does not type-check", () => {
    type Entry = (typeof SCAN_REPORT_COLUMNS)["manifestJson"];
    // @ts-expect-error decode is required on every codec entry
    const missing: Entry = { field: "manifest", encode: (r: ScanReport) => JSON.stringify(r.manifest) };
    void missing;
    const columnType: keyof Scan = "manifestJson";
    expect(columnType in SCAN_REPORT_COLUMNS).toBe(true);
  });
});
