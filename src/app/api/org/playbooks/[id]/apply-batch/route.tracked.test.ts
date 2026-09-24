// POST /api/org/playbooks/:id/apply-batch over the org's TRACKED set (backlog develop-2026-09-17
// row 41): a batch may mix the org's own repos with repos it tracks under another owner; one random
// owner still refuses the whole batch with 400. Each target writes with the token of the installation
// that covers it (self-hosted: the repo owner's).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  applyPlaybook: vi.fn(async () => true),
  getPlaybook: vi.fn(async () => ({ id: "pb_1", title: "Tighten CI", dimId: "D2", summary: "s", steps: ["lint"], version: 1 })),
  getPlaybookOrgSlug: vi.fn(async () => "kiro"),
  getInstallationIdForOwner: vi.fn(async (owner: string) => `inst-${owner}`),
  getOrgId: vi.fn(async () => null),
  isDbConfigured: () => true,
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/org-admission", () => ({
  orgTracksRepo: vi.fn(async (org: string, full: string) => org === "kiro" && full === "xkazm04/kp"),
}));
vi.mock("@/lib/github/source", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/source")>("@/lib/github/source");
  return { ...actual, fetchRepoContext: vi.fn(async (p: { owner: string; repo: string }) => ({ fullName: `${p.owner}/${p.repo}` })) };
});
vi.mock("@/lib/github/write", () => ({ openDraftPr: vi.fn(async () => ({ url: "u", number: 1, reused: false })) }));
vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return {
    AppApiError: actual.AppApiError,
    getInstallationToken: vi.fn(async (id: string) => `token-${id}`),
    isAppConfigured: () => true,
  };
});
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));

import { POST } from "./route";
import { openDraftPr } from "@/lib/github/write";

const mockPr = vi.mocked(openDraftPr);

const run = (repos: string[]) =>
  POST(
    new Request("http://localhost/api/org/playbooks/pb_1/apply-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repos }),
    }),
    { params: Promise.resolve({ id: "pb_1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASCENT_SELF_HOSTED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("playbook apply-batch over the tracked set", () => {
  it("opens a PR in the org's repo AND the tracked foreign repo, each with its installation's token", async () => {
    const res = await run(["kiro/site", "xkazm04/kp"]);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: { repo: string; ok: boolean }[] };
    expect(json.results.every((r) => r.ok)).toBe(true);
    const writes = mockPr.mock.calls.map((c) => [`${c[0].owner}/${c[0].repo}`, c[0].token]).sort();
    expect(writes).toEqual([
      ["kiro/site", "token-inst-kiro"],
      ["xkazm04/kp", "token-inst-xkazm04"],
    ]);
  });

  it("refuses the whole batch with 400 when one repo is a random owner", async () => {
    const res = await run(["xkazm04/kp", "facebook/react"]);
    expect(res.status).toBe(400);
    expect(mockPr).not.toHaveBeenCalled();
  });
});
