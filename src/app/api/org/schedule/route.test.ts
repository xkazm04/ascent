// POST /api/org/schedule — slug identity. Import and scan canonicalize before the gate AND the
// mutation; this sibling used to pass `body.org` raw, so a mixed-case cadence write passed the
// gate then missed the canonical org row (setWatchedSchedule's private findUnique).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  setRepoSchedule: vi.fn(async () => {}),
  setWatchedSchedule: vi.fn(async () => ["acme/web"]),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireFleetOrg: vi.fn(async () => null),
}));

import { POST } from "./route";
import { setRepoSchedule, setWatchedSchedule } from "@/lib/db";
import { requireOrgAccess, requireFleetOrg } from "@/lib/authz";

const mockRepo = vi.mocked(setRepoSchedule);
const mockWatched = vi.mocked(setWatchedSchedule);
const mockAccess = vi.mocked(requireOrgAccess);
const mockFleet = vi.mocked(requireFleetOrg);

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/org/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null);
  mockFleet.mockResolvedValue(null);
});

describe("POST /api/org/schedule canonicalizes the org", () => {
  it("canonicalizes before the gate AND a single-repo cadence write", async () => {
    const res = await POST(post({ org: "  AcMe ", fullName: "acme/web", schedule: "weekly" }));
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockFleet).toHaveBeenCalledWith("acme");
    expect(mockRepo).toHaveBeenCalledWith("acme", "acme/web", "weekly");
  });

  it("canonicalizes the fleet-level (no fullName) cadence write", async () => {
    const res = await POST(post({ org: "  AcMe ", schedule: "daily" }));
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockWatched).toHaveBeenCalledWith("acme", "daily", null);
  });

  it("400s a whitespace-only org rather than looking up a blank slug", async () => {
    const res = await POST(post({ org: "   ", schedule: "weekly" }));
    expect(res.status).toBe(400);
    expect(mockRepo).not.toHaveBeenCalled();
    expect(mockWatched).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
  });
});
