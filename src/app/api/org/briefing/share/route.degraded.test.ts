// Sweep doors on the mint route: the fingerprint, scope and audit-org reads degrade (the link is still
// minted, never a 500 on the mint) but each degrade is logged by name and reported.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn() }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, getViewer: vi.fn(async () => ({ login: "owner-a" })) }));
vi.mock("@/lib/briefing-share", () => ({
  briefingShareEnabled: () => true,
  briefingFigureDigest: vi.fn(() => "fig"),
  freezeShareWindow: vi.fn(() => ({ winStart: null, winEnd: "2026-08-01T00:00:00.000Z", winEndX: "2026-08-01T00:00:00.001Z" })),
  signBriefingShareToken: vi.fn(() => ({ token: "t", jti: "j", expiresAt: 1 })),
}));
vi.mock("@/lib/org/briefing", () => ({ buildExecBriefing: vi.fn() }));
vi.mock("@/lib/db/org-share", () => ({ listBriefingShareGrants: vi.fn(async () => []) }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgId: vi.fn(),
  getTechGroupIdByKey: vi.fn(),
  recordAudit: vi.fn(async () => true),
}));

import { POST } from "./route";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getOrgId, getTechGroupIdByKey } from "@/lib/db";

const boom = new Error("db down");
const mint = () => POST(new Request("http://localhost/api/org/briefing/share", { method: "POST", body: "{}" }));
const warned = () => vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getOrgId).mockRejectedValue(boom);
});

describe("mint route degrades reach a door", () => {
  it("still mints, and names the failed stack-scope and audit-org reads", async () => {
    vi.mocked(requireOrgOwnerPost).mockResolvedValue({ org: "acme", body: { stack: "backend" } } as never);
    vi.mocked(getTechGroupIdByKey).mockRejectedValue(boom);
    expect((await mint()).status).toBe(200);
    expect(warned()).toContain("briefing mint stack scope failed");
    expect(warned()).toContain("briefing mint audit org id failed");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("still mints, and names the failed fingerprint snapshot", async () => {
    vi.mocked(requireOrgOwnerPost).mockResolvedValue({ org: "acme", body: {} } as never);
    vi.mocked(buildExecBriefing).mockRejectedValue(boom);
    expect((await mint()).status).toBe(200);
    expect(warned()).toContain("briefing mint fingerprint snapshot failed");
  });
});
