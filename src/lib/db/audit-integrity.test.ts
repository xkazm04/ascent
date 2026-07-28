import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signAudit, withAuditSignature, verifyAudit, sha256Hex } from "./audit-integrity";

const ROW = {
  action: "org.plan",
  orgId: "org_1",
  actorId: "alice",
  createdAt: "2026-06-20T00:00:00.000Z",
  meta: { plan: "team", org: "acme" },
};

describe("audit-integrity — per-row HMAC signing", () => {
  describe("with a signing secret configured", () => {
    beforeEach(() => {
      process.env.AUDIT_SIGNING_SECRET = "test-secret";
    });
    afterEach(() => {
      delete process.env.AUDIT_SIGNING_SECRET;
    });

    it("signs deterministically and is order-independent over meta keys", () => {
      const a = signAudit(ROW);
      const b = signAudit({ ...ROW, meta: { org: "acme", plan: "team" } }); // keys reordered
      expect(a).toBeTruthy();
      expect(a).toBe(b);
    });

    it("folds _sig into meta and verifies it back as ok", () => {
      const meta = withAuditSignature(ROW);
      expect(typeof meta._sig).toBe("string");
      expect(verifyAudit({ ...ROW, meta })).toBe("ok");
    });

    it("detects tampering — any change to a signed field fails verification", () => {
      const meta = withAuditSignature(ROW);
      expect(verifyAudit({ ...ROW, meta, actorId: "mallory" })).toBe("tampered"); // actor swapped
      expect(verifyAudit({ ...ROW, meta: { ...meta, plan: "enterprise" } })).toBe("tampered"); // meta edited
    });

    it("reports an unsigned row (no _sig) distinctly from a tampered one", () => {
      expect(verifyAudit(ROW)).toBe("unsigned");
    });
  });

  describe("without a signing secret (inert)", () => {
    beforeEach(() => {
      delete process.env.AUDIT_SIGNING_SECRET;
      delete process.env.AUTH_SECRET;
    });

    it("does not sign and verification reports no-secret", () => {
      expect(signAudit(ROW)).toBeNull();
      expect(withAuditSignature(ROW)).toEqual(ROW.meta); // meta unchanged
      expect(verifyAudit(ROW)).toBe("no-secret");
    });
  });
});

// G2-06: verification had ZERO production callers — it was signed on write and never checked on read.
// The read path (getAuditLog, and through it the dashboard + the CSV export) reconstructs the signed
// input from a STORED row, where the timestamp lives on `at`, not `createdAt`. Getting that mapping
// wrong would silently report every row as `tampered`, so pin the stored-row shape end to end.
describe("audit-integrity — read-path verification over a STORED row shape", () => {
  beforeEach(() => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.AUDIT_SIGNING_SECRET;
  });

  // What a read sees: the DB row's fields, with `at` re-serialized from a Date.
  const stored = (meta: Record<string, unknown>) => ({
    action: ROW.action,
    orgId: ROW.orgId,
    actorId: ROW.actorId,
    createdAt: new Date(ROW.createdAt).toISOString(), // getAuditLog passes row.at.toISOString()
    meta,
  });

  it("verifies an intact stored row as ok (write-time signature survives the Date round-trip)", () => {
    expect(verifyAudit(stored(withAuditSignature(ROW)))).toBe("ok");
  });

  it("flags a row edited at rest as tampered", () => {
    const signed = withAuditSignature(ROW);
    // Simulate a direct DB edit: the content changes, the stale `_sig` stays.
    expect(verifyAudit(stored({ ...signed, plan: "enterprise" }))).toBe("tampered");
  });

  it("reports a legacy row written before signing existed as unsigned, not tampered", () => {
    expect(verifyAudit(stored({ plan: "team", org: "acme" }))).toBe("unsigned");
  });
});

describe("audit-integrity — export checksum (sha256Hex)", () => {
  it("is a 64-char hex digest, stable, and changes when the content changes", () => {
    const body = "at,action\n2026-06-20,org.plan\n";
    expect(sha256Hex(body)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(body)).toBe(sha256Hex(body));
    expect(sha256Hex(body)).not.toBe(sha256Hex(body + "2026-06-21,org.member.removed\n"));
  });
});
