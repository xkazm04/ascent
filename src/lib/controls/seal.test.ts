import { describe, expect, it } from "vitest";
import { DIGEST_FIELD_ORDER, dayRoot, isClosedDay, rowDigest, utcDay, type SealableRow } from "@/lib/controls/seal";

const base: SealableRow = {
  orgId: "org-1",
  repoFullName: "acme/api",
  controlId: "branch-protection",
  state: "pass",
  value: "true",
  prevState: null,
  prevValue: null,
  source: "probe",
  actorLogin: null,
  transition: false,
  occurredAt: "2026-08-20T10:00:00.000Z",
  evidenceJson: '{"branch":"main"}',
};

describe("rowDigest", () => {
  it("is independent of the caller's key order", () => {
    // Same fields, built in a different literal order — the digest must not notice.
    const reordered = {
      evidenceJson: base.evidenceJson,
      transition: base.transition,
      occurredAt: base.occurredAt,
      actorLogin: base.actorLogin,
      source: base.source,
      prevValue: base.prevValue,
      prevState: base.prevState,
      value: base.value,
      state: base.state,
      controlId: base.controlId,
      repoFullName: base.repoFullName,
      orgId: base.orgId,
    } satisfies SealableRow;
    expect(rowDigest(reordered)).toBe(rowDigest(base));
  });

  it("changes when any signed field changes", () => {
    for (const k of DIGEST_FIELD_ORDER) {
      const mutated = { ...base, [k]: k === "transition" ? true : "MUTATED" } as SealableRow;
      expect(rowDigest(mutated), `field ${k} must be covered by the digest`).not.toBe(rowDigest(base));
    }
  });

  it("is secret-free and deterministic across calls", () => {
    expect(rowDigest(base)).toBe(rowDigest(base));
    expect(rowDigest(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("dayRoot", () => {
  it("is independent of the order the digests arrive in", () => {
    expect(dayRoot(["b", "a", "c"], null)).toBe(dayRoot(["a", "b", "c"], null));
  });

  it("does NOT dedupe: a duplicated row must not be able to hide", () => {
    expect(dayRoot(["a", "a"], null)).not.toBe(dayRoot(["a"], null));
  });

  // The spec's fail-before case (c): deleting one row's digest changes the root, so a chain check
  // recomputed over the surviving rows reports chainOk === false.
  it("changes when a row's digest is removed", () => {
    const full = dayRoot([rowDigest(base), rowDigest({ ...base, controlId: "signed-commits" })], null);
    const missing = dayRoot([rowDigest(base)], null);
    expect(missing).not.toBe(full);
  });

  it("chains: the same day's rows under a different prevRoot give a different root", () => {
    expect(dayRoot(["a"], "root-of-yesterday")).not.toBe(dayRoot(["a"], null));
  });
});

describe("utcDay / isClosedDay", () => {
  it("places an instant in its UTC calendar day", () => {
    expect(utcDay("2026-08-20T23:59:59.999Z")).toBe("2026-08-20");
    expect(utcDay("2026-08-21T00:00:00.000Z")).toBe("2026-08-21");
  });

  it("returns null for an unparseable stamp rather than filing it under today", () => {
    expect(utcDay("not-a-date")).toBeNull();
  });

  it("only a day strictly before today is closed", () => {
    const now = Date.parse("2026-08-21T12:00:00.000Z");
    expect(isClosedDay("2026-08-20", now)).toBe(true);
    expect(isClosedDay("2026-08-21", now)).toBe(false);
    expect(isClosedDay("2026-08-22", now)).toBe(false);
  });
});
