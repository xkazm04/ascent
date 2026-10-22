// Pins POST /api/org/gate-policy/preview: owner-gated like the write it previews, and READ-ONLY - it
// writes no policy, records no audit row and schedules no PR sweep. The impact itself is computed by
// the real gatePolicyImpact over the real fleet resolver (only the data edges are stubbed).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // Extends Response so a denial built with NextResponse.json passes the route's instanceof check.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new this(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
  after: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgGatePolicy: vi.fn(async () => ({ minLevel: "L2", requireChecks: ["control.prepush.lint"] })),
  getOrgRollup: vi.fn(),
  setOrgGatePolicy: vi.fn(),
  recordOrgAudit: vi.fn(),
  listWatchedRepos: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
}));
vi.mock("@/lib/db/org-admission", () => ({ listOrgAdmissions: vi.fn(async () => []) }));
// A NextResponse (the real helper returns one), so requireOrgOwnerPost's refusal passes the route's instanceof check.
vi.mock("@/lib/authz", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireOrgRole: vi.fn(async () => null),
    refusePublicOrgAdmin: vi.fn((org: string) =>
      org.toLowerCase() === "public" ? NextResponse.json({ error: "The shared public org has no owner." }, { status: 403 }) : null,
    ),
  };
});
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));

import { POST } from "./route";
import { NextResponse, after } from "next/server";
import { getOrgRollup, recordOrgAudit, setOrgGatePolicy } from "@/lib/db";
import { listOrgAdmissions } from "@/lib/db/org-admission";
import { refusePublicOrgAdmin, requireOrgRole } from "@/lib/authz";

const DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"].map((dimId) => ({ dimId, score: 70 }));
const latest = (overall: number, extra: Record<string, unknown> = {}) => ({
  level: "L3", overall, adoption: 0, rigor: 0, posture: "governed", scannedAt: "2026-10-01T00:00:00.000Z",
  engine: "claude", dims: DIMS, incomplete: false, ...extra,
});
const rollup = (repos: { fullName: string; latest: ReturnType<typeof latest> | null }[]) =>
  ({ scannedCount: repos.length, repos: repos.map((r) => ({ ...r, name: r.fullName.split("/")[1] })) }) as never;

const preview = (body: unknown) =>
  POST(
    new Request("http://localhost/api/org/gate-policy/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrgRollup).mockResolvedValue(rollup([{ fullName: "acme/a", latest: latest(55) }]));
});

describe("POST /api/org/gate-policy/preview - authorization", () => {
  it("a non-owner is refused at the owner gate and nothing is read", async () => {
    vi.mocked(requireOrgRole).mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never);
    const res = await preview({ org: "acme", policy: { minOverall: 60 } });
    expect(res.status).toBe(403);
    expect(requireOrgRole).toHaveBeenCalledWith("acme", "owner");
    expect(getOrgRollup).not.toHaveBeenCalled();
  });

  it("the shared public org is refused", async () => {
    const res = await preview({ org: "public", policy: { minOverall: 60 } });
    expect(res.status).toBe(403);
    expect(refusePublicOrgAdmin).toHaveBeenCalledWith("public");
    expect(getOrgRollup).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/gate-policy/preview - read-only impact", () => {
  it("an owner gets the impact, and nothing is written, audited or swept", async () => {
    const res = await preview({ org: "acme", policy: { minLevel: "L2", minOverall: 60 } });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.effective).toEqual({ minLevel: "L2", minOverall: 60 });
    expect(d.impact.newlyFailing.map((r: { fullName: string }) => r.fullName)).toEqual(["acme/a"]);
    expect(d.impact.removed).toEqual([{ label: "required controls", was: expect.stringContaining("control.prepush.lint") }]);
    expect(d.admissionUnread).toBe(false);
    expect(setOrgGatePolicy).not.toHaveBeenCalled();
    expect(recordOrgAudit).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("a draft that sanitizes to null is previewed as the archetype default and says so", async () => {
    const res = await preview({ org: "acme", policy: { minOverall: 0 } });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.effective).toBeNull();
    expect(d.impact.assessed).toBe(1);
  });

  it("reads the admission list ONCE and flags an unreadable one instead of previewing it as clean", async () => {
    vi.mocked(listOrgAdmissions).mockRejectedValueOnce(new Error("db down"));
    const d = await (await preview({ org: "acme", policy: { minLevel: "L2" } })).json();
    expect(listOrgAdmissions).toHaveBeenCalledTimes(1);
    expect(d.admissionUnread).toBe(true);
  });

  it("an org with no scanned repo previews an empty fleet rather than failing", async () => {
    vi.mocked(getOrgRollup).mockResolvedValueOnce(null);
    const d = await (await preview({ org: "acme", policy: { minLevel: "L4" } })).json();
    expect(d.impact.assessed).toBe(0);
    expect(d.impact.newlyFailing).toEqual([]);
  });
});
