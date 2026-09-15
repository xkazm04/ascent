// @vitest-environment node
//
// POST /api/org/alerts — the threshold half of the sink config.
//
// WHY THIS FILE EXISTS: the route advertises `overallDrop` and `dimensionDrop` as independently
// optional and gates on `"overallDrop" in body || "dimensionDrop" in body`, but parsed an ABSENT key
// to the same `null` an explicit clear produces — so a documented one-sided update silently reset the
// other threshold to the default. The popover always posts both fields, which is exactly why nothing
// caught it: the only client in the repo never exercises the shape the API promises.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getOrgAlertThresholds: vi.fn(async () => ({ overallDrop: 7, dimensionDrop: 22 })),
  setOrgAlertThresholds: vi.fn(async (_org: string, t: unknown) => t),
  getOrgAlertWebhook: vi.fn(async () => null),
  setOrgAlertWebhook: vi.fn(async (_org: string, url: string | null) => url),
  getAlertsWatermark: vi.fn(async () => null),
  getOrgMovementSince: vi.fn(async () => null),
  listAlertEvents: vi.fn(async () => []),
  markAlertsSeen: vi.fn(async () => true),
  recordOrgAudit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));

import { POST } from "./route";
import { getOrgAlertThresholds, setOrgAlertThresholds } from "@/lib/db";

const mockGet = vi.mocked(getOrgAlertThresholds);
const mockSet = vi.mocked(setOrgAlertThresholds);

function post(body: unknown): Request {
  return new Request("https://ascent.test/api/org/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/org/alerts — thresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ overallDrop: 7, dimensionDrop: 22 });
    mockSet.mockImplementation(async (_org, t) => t);
  });

  it("a one-sided update leaves the OTHER threshold exactly as stored", async () => {
    await POST(post({ org: "acme", overallDrop: 9 }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: 9, dimensionDrop: 22 });
  });

  it("…in the other direction too", async () => {
    await POST(post({ org: "acme", dimensionDrop: 30 }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: 7, dimensionDrop: 30 });
  });

  it("an EXPLICIT null still clears that field back to the default", async () => {
    await POST(post({ org: "acme", overallDrop: null }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: null, dimensionDrop: 22 });
  });

  it("both fields present is a straight write — and costs no extra read", async () => {
    await POST(post({ org: "acme", overallDrop: 4, dimensionDrop: 12 }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: 4, dimensionDrop: 12 });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range value without writing anything", async () => {
    const res = await POST(post({ org: "acme", overallDrop: 0 }));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
