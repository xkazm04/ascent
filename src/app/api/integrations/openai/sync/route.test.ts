// Pins the OpenAI Costs sync endpoint, mirroring copilot/sync/route.test.ts: the guards, the typed
// failures, and the ONE thing this connector adds that Copilot cannot, org-scope records with REAL
// costCents, which is what turns `hasAllocatedCost` on for Delivery.
//
// Only the network half is mocked (`fetchOpenAICosts`, fed the recorded fixture). The bucket mapping
// runs for real, so the stored records are the ones the fixture actually produces.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getOrgId: vi.fn(async () => "org_1"),
  recordUsage: vi.fn(async () => ({ ok: true, stored: 3 })),
  recordAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/provider-credentials", () => ({
  getProviderSecret: vi.fn(),
  recordProviderSync: vi.fn(async () => {}),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  hasOrgRole: vi.fn(async () => true),
}));
vi.mock("@/lib/integrations/openai-costs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/openai-costs")>()),
  fetchOpenAICosts: vi.fn(),
}));

import { POST } from "./route";
import { isDbConfigured, recordUsage, recordAudit } from "@/lib/db";
import { getProviderSecret, recordProviderSync } from "@/lib/db/provider-credentials";
import { requireOrgAccess, hasOrgRole } from "@/lib/authz";
import { fetchOpenAICosts, type OpenAICostsPull } from "@/lib/integrations/openai-costs";
import { COSTS_PAGE_1, COSTS_PAGE_2 } from "@/lib/integrations/openai-costs.fixture";
import type { UsageRecordInput } from "@/lib/db";

const KEY = "sk-admin-ROUTE-TEST-secret-0123456789";
const mockDb = vi.mocked(isDbConfigured);
const mockRecordUsage = vi.mocked(recordUsage);
const mockAudit = vi.mocked(recordAudit);
const mockSecret = vi.mocked(getProviderSecret);
const mockSyncState = vi.mocked(recordProviderSync);
const mockAccess = vi.mocked(requireOrgAccess);
const mockRole = vi.mocked(hasOrgRole);
const mockFetch = vi.mocked(fetchOpenAICosts);

const FULL: OpenAICostsPull = { buckets: [...COSTS_PAGE_1.data!, ...COSTS_PAGE_2.data!], pages: 2, complete: true, stop: null };

function mkReq(body: unknown): Request {
  return new Request("http://localhost/api/integrations/openai/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockReturnValue(true);
  mockAccess.mockResolvedValue(null);
  mockRole.mockResolvedValue(true);
  mockSecret.mockResolvedValue({ key: KEY, projectIds: ["proj_codex"], reason: null });
  mockRecordUsage.mockResolvedValue({ ok: true, stored: 3 });
  mockFetch.mockResolvedValue(FULL);
});

describe("POST /api/integrations/openai/sync: the guards", () => {
  it("403s a member before any key is decrypted or any call is made", async () => {
    mockRole.mockResolvedValue(false);
    expect((await POST(mkReq({ org: "acme" }))).status).toBe(403);
    expect(mockSecret).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("503s without a database, before the org is even authorized", async () => {
    mockDb.mockReturnValue(false);
    expect((await POST(mkReq({ org: "acme" }))).status).toBe(503);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("400s a missing org", async () => {
    expect((await POST(mkReq({}))).status).toBe(400);
    expect(mockRole).not.toHaveBeenCalled();
  });

  it("409s an org with no stored admin key, and says how to connect one", async () => {
    mockSecret.mockResolvedValue({ key: null, projectIds: [], reason: "absent" });
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("admin key") });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/openai/sync: an empty pull answers from the typed failure", () => {
  it.each([
    ["denied", 403, "Admin"],
    ["rate-limited", 429, "rate"],
    ["unreachable", 502, "reached"],
    ["malformed", 502, "unexpected"],
  ] as const)("%s -> %i, stores nothing, records the sync as failed", async (stop, status, words) => {
    mockFetch.mockResolvedValue({ buckets: [], pages: 0, complete: false, stop });
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining(words) });
    expect(mockRecordUsage).not.toHaveBeenCalled();
    expect(mockSyncState).toHaveBeenCalledWith("acme", "openai", expect.objectContaining({ status: "failed" }));
  });
});

describe("POST /api/integrations/openai/sync: the happy path stores REAL cost", () => {
  it("stores org-scope allocated day records with costCents > 0, in replace mode, with the project filter", async () => {
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(KEY, expect.objectContaining({ projectIds: ["proj_codex"] }));
    const [org, records, opts] = mockRecordUsage.mock.calls[0]!;
    expect(org).toBe("acme");
    expect(opts).toEqual({ mode: "replace" });
    const recs = records as UsageRecordInput[];
    expect(recs.every((r) => r.source === "openai" && r.scope === "org" && r.fidelity === "allocated")).toBe(true);
    // The Evaluation's After: POST sync persists org-scope costCents > 0.
    expect(recs.reduce((s, r) => s + (r.costCents ?? 0), 0)).toBe(1379);
  });

  it("answers with the summary, complete, and never with the key", async () => {
    const res = await POST(mkReq({ org: "acme" }));
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ synced: true, days: 3, costCents: 1379, stored: 3, partial: false });
  });

  it("records the sync complete with its covered span, and audits it without the key", async () => {
    await POST(mkReq({ org: "acme" }));
    expect(mockSyncState).toHaveBeenCalledWith("acme", "openai", expect.objectContaining({
      status: "complete",
      from: new Date("2026-08-01T00:00:00Z"),
      through: new Date("2026-08-04T00:00:00Z"),
    }));
    expect(mockAudit).toHaveBeenCalledWith(
      "integrations.openai.sync",
      expect.objectContaining({ days: 3, costCents: 1379, stored: 3, partial: false }),
      { orgId: "org_1" },
    );
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(KEY);
  });
});

describe("POST /api/integrations/openai/sync: a short pull is PARTIAL, never a complete window", () => {
  it.each(["page-cap", "rate-limited", "unreachable"] as const)("%s after some pages stores what it read and says partial", async (stop) => {
    mockFetch.mockResolvedValue({ buckets: COSTS_PAGE_1.data!, pages: 1, complete: false, stop });
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partial: boolean; partialReason: string };
    expect(body.partial).toBe(true);
    expect(body.partialReason.length).toBeGreaterThan(0);
    expect(mockSyncState).toHaveBeenCalledWith("acme", "openai", expect.objectContaining({ status: "partial" }));
    expect(mockAudit).toHaveBeenCalledWith("integrations.openai.sync", expect.objectContaining({ partial: true, stop }), { orgId: "org_1" });
  });
});
