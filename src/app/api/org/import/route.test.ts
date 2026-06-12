// Pins the import funnel's token discipline (org-scanning 06-11 #2): the route is a deliberately
// anonymous public funnel that accepts an explicit `repos[]` list, so its SCANS must be token-less
// by construction unless a session-gated installation token was minted — the ambient GITHUB_TOKEN
// (an operator PAT, often with private `repo` scope) must never become a confused deputy that
// ingests an attacker-named private repo into the open org. Auth-off (local/demo) deployments keep
// the prior open behavior (the documented seeding path).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/db", () => ({
  consumeScanCredit: vi.fn(),
  getInstallationIdForOwner: vi.fn(async () => null),
  grantCredits: vi.fn(),
  isDbConfigured: () => true,
  persistScanReport: vi.fn(async () => null),
  recordScanOutcome: vi.fn(async () => {}),
  setRepoSchedule: vi.fn(async () => {}),
  setRepoWatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({
  getInstallationToken: vi.fn(async () => "app-installation-token"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/github/list", () => ({ listOrgRepos: vi.fn(async () => []) }));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({
  sessionHasInstallation: vi.fn(async () => false),
  sessionOwnsOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: true, balance: 0 })),
  paymentRequired: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: () => ({ ok: true }),
  tooManyRequests: vi.fn(),
  ORG_IMPORT_RATE_LIMIT: {},
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { isAuthConfigured } from "@/lib/auth";
import { sessionOwnsOrg } from "@/lib/authz";
import { getInstallationIdForOwner } from "@/lib/db";

const mockScan = vi.mocked(scanRepository);
const mockAuthOn = vi.mocked(isAuthConfigured);
const mockOwnsOrg = vi.mocked(sessionOwnsOrg);
const mockInstallId = vi.mocked(getInstallationIdForOwner);

const report = {
  engine: { provider: "mock", model: "m" },
  level: { id: "l2" },
  posture: { id: "balanced" },
  overallScore: 50,
  adoptionScore: 50,
  rigorScore: 50,
  contributors: [],
} as unknown as ScanReport;

async function runImport(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  await res.text(); // drain the SSE stream so the scan work runs to completion
}

const savedToken = process.env.GITHUB_TOKEN;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = "operator-pat-with-repo-scope";
  mockScan.mockResolvedValue(report);
  mockAuthOn.mockReturnValue(true);
  mockOwnsOrg.mockResolvedValue(false);
  mockInstallId.mockResolvedValue(null);
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

describe("POST /api/org/import — ambient-token discipline", () => {
  it("scans token-less (noAmbientToken) for an anonymous caller naming explicit repos", async () => {
    await runImport({ org: "public", repos: ["victim/secret"], mock: true, watch: false });
    expect(mockScan).toHaveBeenCalledTimes(1);
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBeUndefined();
    expect(opts.noAmbientToken).toBe(true);
  });

  it("scans with the minted installation token when the session owns the org", async () => {
    mockOwnsOrg.mockResolvedValue(true);
    mockInstallId.mockResolvedValue("inst-1");
    await runImport({ org: "acme", repos: ["acme/app"], mock: true, watch: false });
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBe("app-installation-token");
    expect(opts.noAmbientToken).toBeUndefined();
  });

  it("keeps the env token on an auth-off (local/demo) deployment — the documented seeding path", async () => {
    mockAuthOn.mockReturnValue(false);
    await runImport({ org: "public", repos: ["some/repo"], mock: true, watch: false });
    const opts = mockScan.mock.calls[0][1]!;
    expect(opts.token).toBe("operator-pat-with-repo-scope");
    expect(opts.noAmbientToken).toBeUndefined();
  });
});
