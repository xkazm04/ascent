// @vitest-environment node
//
// The ONE audit-ledger write door (src/lib/db/audit-append.ts). Pins the envelope every writer now
// shares: one clock, the signed instant IS the stored instant, the meta is signed then stringified,
// and the door is inert (unsigned, never failing) without a signing secret.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAudit } from "@/lib/db/audit-integrity";
import {
  appendAudit,
  appendAuditBatch,
  auditRowData,
  auditRowsData,
  redactAuditRow,
} from "@/lib/db/audit-append";

const SAVED = { a: process.env.AUDIT_SIGNING_SECRET, b: process.env.AUTH_SECRET };

function restore() {
  if (SAVED.a === undefined) delete process.env.AUDIT_SIGNING_SECRET;
  else process.env.AUDIT_SIGNING_SECRET = SAVED.a;
  if (SAVED.b === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = SAVED.b;
}

function verifyRow(row: { action: string; orgId: string | null; actorId: string | null; at: Date; meta: string }) {
  return verifyAudit({
    action: row.action,
    orgId: row.orgId,
    actorId: row.actorId,
    createdAt: row.at.toISOString(),
    meta: JSON.parse(row.meta) as Record<string, unknown>,
  });
}

describe("auditRowData / auditRowsData (pure envelope)", () => {
  afterEach(restore);

  it("signs over the stamped instant: `at` is a Date, meta carries _sig, and the row verifies ok", () => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
    const row = auditRowData({ action: "x", orgId: "o", actorId: null, meta: { a: 1 } });
    expect(row.at).toBeInstanceOf(Date);
    const parsed = JSON.parse(row.meta) as Record<string, unknown>;
    expect(typeof parsed._sig).toBe("string");
    expect(parsed.a).toBe(1);
    expect(verifyRow(row)).toBe("ok");
  });

  it("is inert without a secret: no _sig, and verify reads no-secret", () => {
    delete process.env.AUDIT_SIGNING_SECRET;
    delete process.env.AUTH_SECRET;
    const row = auditRowData({ action: "x", orgId: "o", actorId: null, meta: { a: 1 } });
    expect(JSON.parse(row.meta)).toEqual({ a: 1 });
    expect(verifyRow(row)).toBe("no-secret");
  });

  it("a batch shares ONE `at`, and every row verifies ok over that instant", () => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
    const sharedAt = new Date("2026-10-22T10:00:00.000Z");
    const rows = auditRowsData(
      [
        { action: "recommendation.updated", orgId: "o", actorId: null, meta: { id: "a" } },
        { action: "recommendation.updated", orgId: "o", actorId: null, meta: { id: "b" } },
      ],
      sharedAt,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.at).toBe(sharedAt);
    expect(rows[1]!.at).toBe(sharedAt);
    for (const r of rows) expect(verifyRow(r)).toBe("ok");
    expect(JSON.parse(rows[0]!.meta)._sig).not.toBe(JSON.parse(rows[1]!.meta)._sig);
  });
});

describe("appendAudit / appendAuditBatch / redactAuditRow (client-taking writers)", () => {
  beforeEach(() => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
  });
  afterEach(restore);

  it("appendAudit calls client.auditLog.create exactly once with the auditRowData envelope", async () => {
    const create = vi.fn(async () => ({ id: "row_1" }));
    const at = new Date("2026-10-22T11:00:00.000Z");
    const fields = { action: "claim", orgId: "o", actorId: "u1", meta: { k: "v" } };
    const id = await appendAudit({ auditLog: { create } } as never, fields, { at });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = (create.mock.calls[0] as unknown as [{ data: unknown; select: unknown }])[0];
    expect(arg.data).toEqual(auditRowData(fields, at));
    expect(arg.select).toEqual({ id: true });
    expect(id).toBe("row_1");
    expect(verifyRow(arg.data as ReturnType<typeof auditRowData>)).toBe("ok");
  });

  it("appendAuditBatch calls createMany once with every row on the shared instant", async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    const at = new Date("2026-10-22T12:00:00.000Z");
    const batch = [
      { action: "a", orgId: "o", actorId: null, meta: { id: "1" } },
      { action: "a", orgId: "o", actorId: null, meta: { id: "2" } },
    ];
    await appendAuditBatch({ auditLog: { createMany } } as never, batch, at);
    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = (createMany.mock.calls[0] as unknown as [{ data: unknown }])[0];
    expect(arg.data).toEqual(auditRowsData(batch, at));
  });

  it("redactAuditRow writes actorId null and a re-signed {_redacted, _sig} meta that verifies ok", async () => {
    const update = vi.fn(async () => ({}));
    const rowAt = new Date("2026-01-02T03:04:05.000Z");
    const redactedAt = "2026-10-22T13:00:00.000Z";
    await redactAuditRow(
      { auditLog: { update } } as never,
      { id: "r1", action: "scan.created", orgId: "o", at: rowAt },
      redactedAt,
    );
    expect(update).toHaveBeenCalledTimes(1);
    const arg = (update.mock.calls[0] as unknown as [{ where: unknown; data: { actorId: null; meta: string } }])[0];
    expect(arg.where).toEqual({ id: "r1" });
    expect(arg.data.actorId).toBeNull();
    const meta = JSON.parse(arg.data.meta) as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["_redacted", "_sig"]);
    expect(meta._redacted).toBe(redactedAt);
    expect(
      verifyAudit({ action: "scan.created", orgId: "o", actorId: null, createdAt: rowAt.toISOString(), meta }),
    ).toBe("ok");
  });
});
