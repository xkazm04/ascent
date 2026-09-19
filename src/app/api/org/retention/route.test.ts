import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        status: (init as { status?: number } | undefined)?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(() => true),
  recordOrgAudit: vi.fn(async () => true),
  getOrgRetention: vi.fn(),
  setOrgRetention: vi.fn(),
  previewOrgRetention: vi.fn(),
  requireOrgRole: vi.fn(),
  requireSameOrigin: vi.fn(),
  resolveViewerLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/db/retention", () => ({
  getOrgRetention: h.getOrgRetention,
  setOrgRetention: h.setOrgRetention,
  previewOrgRetention: h.previewOrgRetention,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: h.requireSameOrigin }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));

import { GET, POST } from "./route";
import { NextResponse } from "next/server";
import { RETENTION_MIN_SCANS_PER_REPO } from "@/lib/db/retention-policy";

const VIEW = {
  stored: {
    retentionMaxScans: 10,
    retentionAuditDays: 30,
    retentionCompact: true,
    retentionDigestMonths: 12,
  },
  defaults: { maxScansPerRepo: 0, auditDays: 0, batchSize: 500 },
  effective: { maxScansPerRepo: 10, auditDays: 30, batchSize: 500 },
  compactDefault: false,
  digestMonthsDefault: 0,
  floors: { maxScansPerRepo: 5, auditDays: 7 },
};

const COLUMNS = VIEW.stored;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/org/retention", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.requireOrgRole.mockResolvedValue(null);
  h.requireSameOrigin.mockReturnValue(null);
  h.getOrgRetention.mockResolvedValue(VIEW);
  h.setOrgRetention.mockResolvedValue({ ok: true, view: VIEW });
  h.previewOrgRetention.mockResolvedValue({
    dryRun: true,
    results: [{ orgSlug: "acme", scansDeleted: 3, dimensionsDeleted: 0, recommendationsDeleted: 0, auditDeleted: 1, digestsWouldWrite: 0 }],
    errors: [],
  });
  h.resolveViewerLogin.mockResolvedValue("owner-a");
  h.recordOrgAudit.mockResolvedValue(true);
});

describe("GET /api/org/retention", () => {
  it("is owner-gated and returns all four columns", async () => {
    const res = await GET(new Request("http://localhost/api/org/retention?org=acme"));
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "owner");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VIEW);
  });

  it("returns a non-owner denial and does not read columns", async () => {
    const denial = NextResponse.json({ error: "owner only" }, { status: 403 });
    h.requireOrgRole.mockResolvedValue(denial);
    const res = await GET(new Request("http://localhost/api/org/retention?org=acme"));
    expect(res).toBe(denial);
    expect(h.getOrgRetention).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/retention", () => {
  it("rejects a cross-origin POST and never writes", async () => {
    const xo = NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    h.requireSameOrigin.mockReturnValue(xo);
    const res = await post({ org: "acme", ...COLUMNS });
    expect(res).toBe(xo);
    expect(h.setOrgRetention).not.toHaveBeenCalled();
    expect(h.previewOrgRetention).not.toHaveBeenCalled();
  });

  it("refuses a sub-floor policy without previewing or writing", async () => {
    const res = await post({ org: "acme", ...COLUMNS, retentionMaxScans: 1 });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/safety floor/);
    expect(json.floors.maxScansPerRepo).toBe(RETENTION_MIN_SCANS_PER_REPO);
    expect(h.setOrgRetention).not.toHaveBeenCalled();
    expect(h.previewOrgRetention).not.toHaveBeenCalled();
  });

  it("preview: true dry-runs and does not write columns", async () => {
    const res = await post({ org: "acme", ...COLUMNS, preview: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dryRun).toBe(true);
    expect(json.preview.scansDeleted).toBe(3);
    expect(h.previewOrgRetention).toHaveBeenCalledWith("acme", COLUMNS);
    expect(h.setOrgRetention).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("save writes columns, never purges, and audits purged: false", async () => {
    const res = await post({ org: "acme", ...COLUMNS });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.purged).toBe(false);
    expect(json.stored).toEqual(COLUMNS);
    expect(h.setOrgRetention).toHaveBeenCalledWith("acme", COLUMNS);
    expect(h.previewOrgRetention).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).toHaveBeenCalledWith(
      "retention.updated",
      "acme",
      expect.objectContaining({ ...COLUMNS, purged: false }),
      "owner-a",
    );
  });
});
