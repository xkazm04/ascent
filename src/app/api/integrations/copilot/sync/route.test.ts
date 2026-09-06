// Pins the Copilot sync endpoint's guards and its ONE storage rule.
//
// Two things here are worth more than the status codes. First, `mode: "replace"`: the Metrics API
// returns each day's TOTALS, so a re-sync over an overlapping window must overwrite those day
// buckets — "add" (correct for the OTel delta path) would accumulate the same day into a fictional
// multiple. Second, the cost note on every success: an owner who connects a provider and then sees
// no money on the ROI panel is told why by the thing they just connected.
//
// Only the GitHub reads are mocked. `buildCopilotUsage`/`summarizeCopilotSync` run for real, so this
// also proves the records the route stores carry no cost.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getInstallationIdForOwner: vi.fn(async () => 4242),
  getOrgId: vi.fn(async () => "org_1"),
  recordUsage: vi.fn(async () => ({ ok: true, stored: 2 })),
  recordAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/github/app", () => ({
  isAppConfigured: vi.fn(() => true),
  getInstallationToken: vi.fn(async () => "ghs_test"),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  hasOrgRole: vi.fn(async () => true),
}));
// Partial mock: only the network half is faked, so the mapping under test is the real one.
vi.mock("@/lib/integrations/copilot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/copilot")>()),
  fetchCopilot: vi.fn(),
}));

import { POST } from "./route";
import { isDbConfigured, getInstallationIdForOwner, recordUsage, recordAudit } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { requireOrgAccess, hasOrgRole } from "@/lib/authz";
import { fetchCopilot, type CopilotSyncInput } from "@/lib/integrations/copilot";
// Type-only (erased at compile), so it costs nothing that "@/lib/db" is mocked above.
import type { UsageRecordInput } from "@/lib/db";

const mockDb = vi.mocked(isDbConfigured);
const mockInstallation = vi.mocked(getInstallationIdForOwner);
const mockRecordUsage = vi.mocked(recordUsage);
const mockAudit = vi.mocked(recordAudit);
const mockAppConfigured = vi.mocked(isAppConfigured);
const mockAccess = vi.mocked(requireOrgAccess);
const mockRole = vi.mocked(hasOrgRole);
const mockFetch = vi.mocked(fetchCopilot);

const PULL: CopilotSyncInput = {
  seats: { total_seats: 42 },
  metrics: [
    { date: "2026-08-01", total_engaged_users: 11 },
    { date: "2026-08-02", total_engaged_users: 17 },
  ],
  seatsFailure: null,
  metricsFailure: null,
};

const EMPTY: CopilotSyncInput = { seats: null, metrics: [], seatsFailure: null, metricsFailure: null };

function mkReq(body: unknown): Request {
  return new Request("http://localhost/api/integrations/copilot/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockReturnValue(true);
  mockAppConfigured.mockReturnValue(true);
  mockAccess.mockResolvedValue(null);
  mockRole.mockResolvedValue(true);
  mockInstallation.mockResolvedValue(4242);
  mockRecordUsage.mockResolvedValue({ ok: true, stored: 2 });
  mockAudit.mockResolvedValue(true);
  mockFetch.mockResolvedValue(PULL);
});

describe("POST /api/integrations/copilot/sync — the guards", () => {
  it("403s a member: connecting a provider reads billing-adjacent data and is owner-only", async () => {
    mockRole.mockResolvedValue(false);
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(403);
    // and nothing was read from GitHub or stored — the refusal happens before any credential is minted
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("503s when the GitHub App is not configured on this deployment", async () => {
    mockAppConfigured.mockReturnValue(false);
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("GitHub App") });
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

  it("404s an org with no App installation", async () => {
    mockInstallation.mockResolvedValue(null as never);
    expect((await POST(mkReq({ org: "acme" }))).status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/copilot/sync — an empty pull answers from the typed failure", () => {
  it("403s when GitHub denied the reads (a scope problem, and it says so)", async () => {
    mockFetch.mockResolvedValue({ ...EMPTY, seatsFailure: "denied", metricsFailure: "denied" });
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("manage_billing:copilot") });
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("502s an unreachable GitHub rather than blaming the operator's permissions", async () => {
    mockFetch.mockResolvedValue({ ...EMPTY, metricsFailure: "unreachable" });
    expect((await POST(mkReq({ org: "acme" }))).status).toBe(502);
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("422s an accepted credential that simply has no Copilot data", async () => {
    mockFetch.mockResolvedValue(EMPTY);
    expect((await POST(mkReq({ org: "acme" }))).status).toBe(422);
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/copilot/sync — the happy path", () => {
  it("stores the pulled days with mode 'replace', and every record carries zero cost", async () => {
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledTimes(1);
    const [org, records, opts] = mockRecordUsage.mock.calls[0]!;
    expect(org).toBe("acme");
    expect(opts).toEqual({ mode: "replace" });
    expect(records).toHaveLength(2);
    expect((records as UsageRecordInput[]).every((r) => r.costCents === 0)).toBe(true);
    expect((records as UsageRecordInput[]).every((r) => r.seats === 42)).toBe(true);
  });

  it("answers with the summary AND the standing 'seats and engagement, not cost' note", async () => {
    const res = await POST(mkReq({ org: "acme" }));
    const body = (await res.json()) as { synced: boolean; days: number; seats: number; engagedPeak: number; stored: number; note: string };
    expect(body).toMatchObject({ synced: true, days: 2, seats: 42, engagedPeak: 17, stored: 2 });
    expect(body.note).toContain("not spend");
    // The response has no cost field of any kind to be misread as money.
    expect(Object.keys(body)).not.toContain("costCents");
  });

  it("audits the sync against the org", async () => {
    await POST(mkReq({ org: "acme" }));
    expect(mockAudit).toHaveBeenCalledWith(
      "integrations.copilot.sync",
      { days: 2, seats: 42, engagedPeak: 17, stored: 2 },
      { orgId: "org_1" },
    );
  });
});
