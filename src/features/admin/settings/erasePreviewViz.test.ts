// The erasure manifest, as geometry. What is pinned is the claim the prose needed a paragraph and a
// doc comment to make: under redaction the audit trail is in BOTH columns, and under every other
// disposition four rows are void in Erased — the guarantee drawn as nothing to see.

import { describe, expect, it } from "vitest";
import { isVoid, rendersValue } from "@/components/org/viz";
import type { AuditDisposition } from "./eraseTotals";
import { ERASE_AXES, ERASE_MATRIX_HINT, erasePreviewRows, erasePreviewStates } from "./erasePreviewViz";

const ERASED = ERASE_AXES.indexOf("Erased");
const KEPT = ERASE_AXES.indexOf("Kept");
const cells = (d: AuditDisposition, id: string) => erasePreviewRows(d).find((r) => r.id === id)!.cells;

describe("erase preview matrix — the audit row is the only one that moves", () => {
  it("keeps the trail wholly out of the Erased column when the disposition is keep", () => {
    const c = cells("keep", "audit");
    expect(isVoid(c[ERASED]!.state)).toBe(true);
    expect(c[KEPT]!.state).toBe("measured");
  });

  it("puts the trail in BOTH columns under redaction — the thing the sentence could not show", () => {
    // `includeAudit: true` resolves to "redact", which destroys the identities and keeps the account
    // of what happened. A manifest that filed it under one heading would describe a disposition this
    // dialog cannot even request.
    const c = cells("redact", "audit");
    expect(c[ERASED]!.state).toBe("measured");
    expect(c[KEPT]!.state).toBe("measured");
  });

  it("draws a genuine delete as erased-and-not-kept, even though the route refuses it by default", () => {
    const c = cells("delete", "audit");
    expect(c[ERASED]!.state).toBe("measured");
    expect(isVoid(c[KEPT]!.state)).toBe(true);
  });

  it("moves NOTHING else between dispositions", () => {
    const shape = (d: AuditDisposition) =>
      erasePreviewRows(d)
        .filter((r) => r.id !== "audit")
        .map((r) => `${r.id}:${r.cells.map((c) => c.state).join("/")}`);
    expect(shape("redact")).toEqual(shape("keep"));
    expect(shape("delete")).toEqual(shape("keep"));
  });
});

describe("erase preview matrix — what survives is drawn as a void, not promised", () => {
  it("leaves your settings, the org and its members empty in the Erased column", () => {
    for (const id of ["settings", "tenant"]) {
      const c = cells("redact", id);
      expect(isVoid(c[ERASED]!.state)).toBe(true);
      expect(c[KEPT]!.state).toBe("measured");
    }
  });

  it("erases scan history and the scan-derived caches, and keeps neither", () => {
    for (const id of ["scans", "caches"]) {
      const c = cells("keep", id);
      expect(c[ERASED]!.state).toBe("measured");
      expect(isVoid(c[KEPT]!.state)).toBe(true);
    }
  });

  it("carries no numbers at all — the counts are a dl beside the picture, on their own units", () => {
    for (const d of ["keep", "redact", "delete"] as AuditDisposition[]) {
      for (const r of erasePreviewRows(d)) {
        for (const c of r.cells) {
          expect(c.score).toBeUndefined();
          if (!rendersValue(c.state)) expect(isVoid(c.state)).toBe(true);
        }
      }
    }
  });
});

describe("erase preview matrix — the kit contract", () => {
  it("keeps every row label inside MatrixGrid's 104-unit gutter", () => {
    for (const r of erasePreviewRows("redact")) expect(r.label.length).toBeLessThanOrEqual(13);
  });

  it("legends only the two states it draws", () => {
    expect(erasePreviewStates(erasePreviewRows("keep"))).toEqual(["measured", "missing"]);
  });

  it("discloses what an empty cell means here rather than leaving the reader to guess", () => {
    expect(ERASE_MATRIX_HINT).toMatch(/never in the Erased column/i);
    expect(ERASE_MATRIX_HINT).toMatch(/BOTH columns/i);
  });
});
