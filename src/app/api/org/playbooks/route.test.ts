// POST /api/org/playbooks seed: fromDim fills from PLAYBOOK_TEMPLATES; fromRec uses the briefing's
// ranked next move (getOrgRecommendations rank 1). Unknown dim 400s; blank title without a seed is
// still rejected. The mapping itself is pinned in playbook-templates.test.ts — this file is the HTTP
// gate (auth, create payload, no write on 400).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PLAYBOOK_TEMPLATES } from "@/lib/org/playbook-templates";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const {
  mockIsDbConfigured,
  mockCreatePlaybook,
  mockGetOrgRecommendations,
  mockRequireOrgAccess,
  mockResolveViewerLogin,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockCreatePlaybook: vi.fn(),
  mockGetOrgRecommendations: vi.fn(),
  mockRequireOrgAccess: vi.fn(),
  mockResolveViewerLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  createPlaybook: mockCreatePlaybook,
  listPlaybooks: vi.fn(),
  getOrgRecommendations: mockGetOrgRecommendations,
}));

vi.mock("@/lib/authz", () => ({
  requireOrgAccess: mockRequireOrgAccess,
  requireOrgRead: vi.fn(),
}));

vi.mock("@/lib/access", () => ({
  resolveViewerLogin: mockResolveViewerLogin,
}));

import { POST } from "./route";

const d5 = PLAYBOOK_TEMPLATES.find((t) => t.dimId === "D5");
if (!d5) throw new Error("D5 template missing");

function post(body: unknown) {
  return POST(
    new Request("http://t/api/org/playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgAccess.mockResolvedValue(null);
  mockCreatePlaybook.mockResolvedValue({ id: "pb_1" });
  mockResolveViewerLogin.mockResolvedValue("alice");
  mockGetOrgRecommendations.mockResolvedValue([]);
});

describe("POST /api/org/playbooks — fromDim seed", () => {
  it("creates a playbook whose dimId/steps match the D5 template", async () => {
    const res = await post({ org: "acme", fromDim: "D5" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "pb_1" });
    expect(mockCreatePlaybook).toHaveBeenCalledWith(
      "acme",
      { title: d5.title, dimId: "D5", summary: d5.summary, steps: d5.steps },
      "alice",
    );
    expect(mockGetOrgRecommendations).not.toHaveBeenCalled();
  });

  it("400s an unknown dim and does not write", async () => {
    const res = await post({ org: "acme", fromDim: "D99" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "dimId must be D1..D9." });
    expect(mockCreatePlaybook).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/playbooks — fromRec (ranked next move)", () => {
  it("seeds title from the rec and steps from the matching template", async () => {
    mockGetOrgRecommendations.mockResolvedValue([
      { title: "Add ADRs to the 8 repos missing them", dimId: "D5", explore: ["invented"] },
    ]);
    const res = await post({ org: "acme", fromRec: true });
    expect(res.status).toBe(200);
    expect(mockGetOrgRecommendations).toHaveBeenCalledWith("acme", 1);
    expect(mockCreatePlaybook).toHaveBeenCalledWith(
      "acme",
      {
        title: "Add ADRs to the 8 repos missing them",
        dimId: "D5",
        summary: d5.summary,
        steps: d5.steps,
      },
      "alice",
    );
    const input = mockCreatePlaybook.mock.calls[0]?.[1] as { steps: string[] };
    expect(input.steps).not.toContain("invented");
  });

  it("400s when the briefing has no ranked next move", async () => {
    mockGetOrgRecommendations.mockResolvedValue([]);
    const res = await post({ org: "acme", fromRec: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No ranked next move to seed from." });
    expect(mockCreatePlaybook).not.toHaveBeenCalled();
  });

  it("does not read recommendations when the member gate denies", async () => {
    mockRequireOrgAccess.mockResolvedValue(
      Response.json({ error: "You don't have access to this organization." }, { status: 403 }),
    );
    const res = await post({ org: "acme", fromRec: true });
    expect(res.status).toBe(403);
    expect(mockGetOrgRecommendations).not.toHaveBeenCalled();
    expect(mockCreatePlaybook).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/playbooks — unseeded", () => {
  it("still rejects a blank title", async () => {
    const res = await post({ org: "acme", title: "  ", dimId: "D5" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Provide { org, title, dimId }." });
    expect(mockCreatePlaybook).not.toHaveBeenCalled();
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
  });

  it("still creates from an explicit title+dimId", async () => {
    const res = await post({ org: "acme", title: "Ours", dimId: "D3", steps: ["a"] });
    expect(res.status).toBe(200);
    expect(mockCreatePlaybook).toHaveBeenCalledWith(
      "acme",
      { title: "Ours", dimId: "D3", summary: "", steps: ["a"] },
      "alice",
    );
  });
});
