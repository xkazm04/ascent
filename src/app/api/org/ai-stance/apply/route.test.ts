// HITL for /api/org/ai-stance/apply: `preview: true` / `dryRun: true` returns the exact
// AI_POLICY.md bytes and MUST NOT call openArtifactDraftPr (no draft PR). The admin write-role
// gate still runs on preview — policy bytes are org-authored, not public. Absent those flags,
// the existing write path opens one PR.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

const h = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
  openArtifactDraftPr: vi.fn(),
  getActiveOrgStance: vi.fn(),
  getOrgId: vi.fn(),
  resolveViewerLogin: vi.fn(),
  fetchRepoContext: vi.fn(),
}));

vi.mock("@/lib/github/source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github/source")>();
  return { ...actual, fetchRepoContext: h.fetchRepoContext };
});
vi.mock("@/lib/practices/apply", () => ({ openArtifactDraftPr: h.openArtifactDraftPr }));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  isAppConfigured: () => true,
  getInstallationToken: h.getInstallationToken,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getActiveOrgStance: h.getActiveOrgStance,
  getOrgId: h.getOrgId,
  getInstallationIdForOwner: h.getInstallationIdForOwner,
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => true }));
vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  resolveViewerLogin: h.resolveViewerLogin,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
// The REAL pr-route composer runs: the installation lookup and the token mint are the boundary this
// file asserts on, so a cross-tenant mint is visible as a call with the wrong org.

import { POST } from "./route";
import { buildStanceArtifact } from "@/lib/org/stance-artifact";

const stance = {
  permittedTools: ["Claude Code"],
  permittedModels: [],
  noAiZones: [],
  reviewTiers: [],
  provenance: { requireTrailer: true, requireHumanApproval: false },
};
const storedRow = {
  id: "row",
  version: 2,
  status: "published" as const,
  stance,
  publishedBy: "alice",
  publishedAt: new Date("2026-08-12T00:00:00.000Z"),
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
};

const expected = buildStanceArtifact(
  stance,
  { org: "acme", version: 2, publishedAt: "2026-08-12" },
  { fullName: "acme/api", name: "api" },
);
const expectedBytes = new TextEncoder().encode(expected.body).length;

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/org/ai-stance/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOrgRole.mockResolvedValue(null);
  // Every org in these tests HAS an installation, the victim included: the refusal must come from
  // tenancy, not from a missing install.
  h.getInstallationIdForOwner.mockImplementation(async (owner: string) => `inst-${owner}`);
  h.getInstallationToken.mockResolvedValue("installation-token");
  h.openArtifactDraftPr.mockResolvedValue({
    url: "https://github.com/acme/api/pull/7",
    number: 7,
    reused: false,
  });
  h.getActiveOrgStance.mockResolvedValue(storedRow);
  h.getOrgId.mockResolvedValue("org-1");
  h.resolveViewerLogin.mockResolvedValue("alice");
  h.fetchRepoContext.mockResolvedValue({ fullName: "acme/api", name: "api" });
});

function expectNoWrite() {
  expect(h.openArtifactDraftPr).not.toHaveBeenCalled();
  expect(h.getInstallationIdForOwner).not.toHaveBeenCalled();
  expect(h.getInstallationToken).not.toHaveBeenCalled();
  expect(h.fetchRepoContext).not.toHaveBeenCalled();
}

describe("POST /api/org/ai-stance/apply — dry/preview does not open a PR", () => {
  it.each([{ preview: true }, { dryRun: true }] as const)(
    "%o returns AI_POLICY.md bytes and never opens a PR",
    async (flag) => {
      const res = await run({ org: "acme", repo: "acme/api", ...flag });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.preview).toBe(true);
      expect(json.path).toBe("AI_POLICY.md");
      expect(json.body).toBe(expected.body);
      expect(json.body).toContain("Org stance **v2**");
      expect(json.bytes).toBe(expectedBytes);
      expect(json.version).toBe(2);
      expect(json.url).toBeUndefined();
      expectNoWrite();
    },
  );

  it("still requires the admin write-role on preview — a member gets 403 and no bytes", async () => {
    h.requireOrgRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role in this organization." }, { status: 403 }),
    );
    const res = await run({ org: "acme", repo: "acme/api", preview: true });
    expect(res.status).toBe(403);
    expect((await res.json()).body).toBeUndefined();
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expectNoWrite();
  });

  it("401s an unsigned preview before any write", async () => {
    h.resolveViewerLogin.mockResolvedValue(null);
    const res = await run({ org: "acme", repo: "acme/api", preview: true });
    expect(res.status).toBe(401);
    expect(h.requireOrgRole).not.toHaveBeenCalled();
    expectNoWrite();
  });

  it("409s a preview when nothing is published", async () => {
    h.getActiveOrgStance.mockResolvedValue(null);
    const res = await run({ org: "acme", repo: "acme/api", dryRun: true });
    expect(res.status).toBe(409);
    expectNoWrite();
  });
});

describe("POST /api/org/ai-stance/apply — write path", () => {
  it("opens exactly one PR when preview/dryRun are absent", async () => {
    const res = await run({ org: "acme", repo: "acme/api" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://github.com/acme/api/pull/7");
    expect(json.path).toBe("AI_POLICY.md");
    expect(json.preview).toBeUndefined();
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expect(h.getInstallationIdForOwner.mock.calls).toEqual([["acme"]]);
    expect(h.getInstallationToken).toHaveBeenCalledTimes(1);
    expect(h.openArtifactDraftPr).toHaveBeenCalledTimes(1);
  });

  it("dryRun: false keeps the write path", async () => {
    const res = await run({ org: "acme", repo: "acme/api", dryRun: false, preview: false });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://github.com/acme/api/pull/7");
    expect(h.openArtifactDraftPr).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/org/ai-stance/apply — the repo must belong to the gated org", () => {
  it("403s an admin of acme naming victim/app: no victim token, no PR", async () => {
    const res = await run({ org: "acme", repo: "victim/app" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("That repository doesn't belong to acme.");
    expect(h.getInstallationIdForOwner).not.toHaveBeenCalledWith("victim");
    expectNoWrite();
  });

  it("refuses the same coordinate on preview, before any policy bytes are rendered", async () => {
    const res = await run({ org: "acme", repo: "victim/app", preview: true });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("That repository doesn't belong to acme.");
    expect(json.body).toBeUndefined();
    expect(json.bytes).toBeUndefined();
    expectNoWrite();
  });

  it("guard: a mixed-case own-org coordinate still writes, to the lower-cased owner", async () => {
    const res = await run({ org: "Acme", repo: "ACME/api" });
    expect(res.status).toBe(200);
    expect(h.getInstallationIdForOwner.mock.calls).toEqual([["acme"]]);
    expect(h.openArtifactDraftPr.mock.calls[0]![1]).toMatchObject({ owner: "acme", repo: "api" });
  });
});
