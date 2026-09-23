// POST /api/org/admission/propose — what runs on approval is what was shown.
//
// The dry run returns a diff; the confirmed run re-reads the base and re-splices. Until the
// `expectDiffDigest` contract, nothing tied the second read to the first, so an owner who previewed
// one CODEOWNERS diff could open a PR carrying another when the file moved in between. The real
// writer (`proposeManagedBlock`) runs here against a scripted GitHub, so "no branch / PUT / PR call"
// is asserted on the wire, not on a mock of the writer.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new this(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  recordOrgAudit: vi.fn(async () => true),
  getInstallationIdForOwner: vi.fn(async (owner: string) => `inst-${owner}`),
}));
vi.mock("@/lib/db/org-stance", () => ({ getActiveOrgStance: vi.fn(async () => ({ version: 4, stance: {} })) }));
vi.mock("@/lib/db/org-admission", () => ({
  getRepoAdmission: vi.fn(async () => ({ derivedTier: "T1", grantedTier: "T1", mode: "assisted-only", rulesetId: null })),
  orgTracksRepo: vi.fn(async () => true),
}));
vi.mock("@/lib/org/admission", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/org/admission")>();
  const { begin, end } = real.codeownersMarkers(4);
  return { ...real, compileStance: vi.fn(() => ({ codeownersBlock: [begin, "/billing/ @acme/platform", end].join("\n"), ruleset: null })) };
});
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "priya") }));
vi.mock("@/lib/github/app", () => ({
  githubAppFetch: vi.fn(),
  getInstallationToken: vi.fn(async () => "tok"),
  AppApiError: class AppApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly path: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { POST } from "./route";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { githubAppFetch } from "@/lib/github/app";
import { artifactFingerprint } from "@/lib/practices/fingerprint";

const fetchMock = vi.mocked(githubAppFetch);
let codeowners = "* @acme/core";

function scriptGitHub() {
  fetchMock.mockImplementation(async (path: string, _token: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") return { html_url: "https://github.com/xkazm04/kp/pull/7", number: 7 } as never;
    if (path === "/repos/xkazm04/kp") return { default_branch: "main" } as never;
    if (path.startsWith("/repos/xkazm04/kp/contents/CODEOWNERS")) return { content: Buffer.from(codeowners).toString("base64"), sha: "s1" } as never;
    if (path.includes("/git/ref/heads/")) return { object: { sha: "base-sha" } } as never;
    return {} as never;
  });
}

const writes = () => fetchMock.mock.calls.filter(([, , init]) => ((init as RequestInit | undefined)?.method ?? "GET") !== "GET");

async function call(body: Record<string, unknown>) {
  vi.mocked(requireOrgOwnerPost).mockResolvedValue({ org: "acme", body: { repo: "xkazm04/kp", owners: ["@acme/platform"], ...body } } as never);
  const res = await POST(new Request("http://localhost/api/org/admission/propose", { method: "POST" }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  codeowners = "* @acme/core";
  scriptGitHub();
});

describe("propose: the confirmed run is bound to the previewed diff", () => {
  it("409 content-drift when CODEOWNERS changed since the preview, with no branch, PUT or PR call", async () => {
    const preview = await call({});
    expect(preview.status).toBe(200);
    const shown = String(preview.json.diff);
    expect(writes()).toHaveLength(0);

    codeowners = "* @acme/core\n/billing/ @acme/finance";
    const res = await call({ confirm: true, expectDiffDigest: artifactFingerprint(shown) });

    expect(res.status).toBe(409);
    expect(res.json.code).toBe("content-drift");
    // The current diff comes back so the panel can show what WOULD be written now.
    expect(res.json.diff).not.toBe(shown);
    expect(writes()).toHaveLength(0);
  });

  it("a matching digest opens the PR", async () => {
    const preview = await call({});
    const res = await call({ confirm: true, expectDiffDigest: artifactFingerprint(String(preview.json.diff)) });
    expect(res.status).toBe(200);
    expect((res.json.pr as { number: number }).number).toBe(7);
    expect(writes().length).toBeGreaterThan(0);
  });

  it("guard: without expectDiffDigest the route keeps today's behaviour (dry run by default, confirm:true opens the PR)", async () => {
    const dry = await call({});
    expect(dry.json.pr).toBeUndefined();
    expect(writes()).toHaveLength(0);

    const res = await call({ confirm: true });
    expect(res.status).toBe(200);
    expect((res.json.pr as { number: number }).number).toBe(7);
  });
});
