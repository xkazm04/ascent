// moonshot #8 — the admission decision endpoint. Member read, owner write, audited, and
// gate-then-constrain on the caller-supplied repo name.

import { describe, it, expect, vi, beforeEach } from "vitest";

// `static json` constructs the SUBCLASS, not a bare Response: the route distinguishes "the gate
// refused" from "the gate returned a body" with `gate instanceof NextResponse`, and a stand-in that
// returns a plain Response would make that branch untestable.
vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new this(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true), recordOrgAudit: vi.fn(async () => true) }));
vi.mock("@/lib/db/org-stance", () => ({ getActiveOrgStance: vi.fn(async () => ({ version: 4 })) }));
vi.mock("@/lib/db/org-admission", () => ({
  listOrgAdmissions: vi.fn(async () => []),
  upsertRepoAdmission: vi.fn(),
  orgTracksRepo: vi.fn(async () => false),
  MAX_RATIONALE: 500,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));

import { GET, POST, repoUnderOrg } from "./route";
import { recordOrgAudit } from "@/lib/db";
import { listOrgAdmissions, upsertRepoAdmission, orgTracksRepo } from "@/lib/db/org-admission";
import { requireOrgRead } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { resolveViewerLogin } from "@/lib/access";

const mockList = vi.mocked(listOrgAdmissions);
const mockUpsert = vi.mocked(upsertRepoAdmission);
const mockTracks = vi.mocked(orgTracksRepo);
const mockRead = vi.mocked(requireOrgRead);
const mockOwnerPost = vi.mocked(requireOrgOwnerPost);
const mockLogin = vi.mocked(resolveViewerLogin);
const mockAudit = vi.mocked(recordOrgAudit);

const ROW = {
  id: "a1",
  repoFullName: "acme/billing",
  stanceVersion: 4,
  derivedTier: "T1" as const,
  grantedTier: "T3" as const,
  mode: "agents-allowed" as const,
  decidedBy: "octocat",
  decidedAt: "2026-08-30T00:00:00.000Z",
  rationale: "mature test suite",
  rulesetId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const post = (body: Record<string, unknown>) => {
  mockOwnerPost.mockResolvedValue({ org: "acme", body } as never);
  return POST(new Request("http://localhost/api/org/admission", { method: "POST" }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockResolvedValue(null);
  mockLogin.mockResolvedValue("octocat");
  mockUpsert.mockResolvedValue(ROW);
  mockAudit.mockResolvedValue(true);
  mockTracks.mockResolvedValue(false);
});

describe("repoUnderOrg — the gate-then-CONSTRAIN half", () => {
  it("accepts a repo under the gated org's own namespace without a read", async () => {
    expect(await repoUnderOrg("acme", "acme/billing")).toBe("acme/billing");
    expect(await repoUnderOrg("Acme", "acme/billing")).toBe("acme/billing"); // GitHub slugs are case-insensitive
    expect(mockTracks).not.toHaveBeenCalled();
  });

  // UAT PRIYA-L2-C5. The old rule was `owner === org`, so an organization named for its team rather
  // than for its GitHub account could never admit its OWN repositories — org `kiro` and `xkazm04/kp`
  // on the real host, which left the whole remote work protocol unreachable for it.
  it("accepts a repo the org TRACKS even when the owner segment is another namespace", async () => {
    mockTracks.mockResolvedValue(true);
    expect(await repoUnderOrg("kiro", "xkazm04/kp")).toBe("xkazm04/kp");
    expect(mockTracks).toHaveBeenCalledWith("kiro", "xkazm04/kp");
  });

  // The IDOR this closes: gating the org is only half the job when the caller also names the repo.
  it("REFUSES a repository the org does not track, even from an authorized owner", async () => {
    mockTracks.mockResolvedValue(false);
    expect(await repoUnderOrg("acme", "othertenant/secrets")).toBeNull();
  });

  it("refuses a malformed name rather than passing it to a query", async () => {
    mockTracks.mockResolvedValue(true);
    for (const bad of ["", "acme", "acme/", "/billing", "acme/bil ling", "../../etc", 7, null]) {
      expect(await repoUnderOrg("acme", bad)).toBeNull();
    }
    expect(mockTracks).not.toHaveBeenCalled();
  });
});

describe("GET — member read", () => {
  it("returns the rows plus the ACTIVE stance version so staleness is computed once", async () => {
    mockList.mockResolvedValue([ROW]);
    const res = await GET(new Request("http://localhost/api/org/admission?org=acme"));
    expect(await res.json()).toEqual({ rows: [ROW], stanceVersion: 4 });
  });

  it("400s without ?org and honors the member gate's refusal", async () => {
    expect((await GET(new Request("http://localhost/api/org/admission"))).status).toBe(400);
    const { NextResponse } = await import("next/server");
    mockRead.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }) as never);
    expect((await GET(new Request("http://localhost/api/org/admission?org=acme"))).status).toBe(403);
  });
});

describe("POST — owner-gated, validated, audited", () => {
  it("records the decision and returns the row", async () => {
    const res = await post({ repo: "acme/billing", grantedTier: "T3", mode: "agents-allowed", rationale: "mature test suite" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, row: ROW });
    expect(mockUpsert).toHaveBeenCalledWith("acme", "acme/billing", {
      grantedTier: "T3",
      mode: "agents-allowed",
      rationale: "mature test suite",
      decidedBy: "octocat",
    });
  });

  it("audits the grant BESIDE the derived tier — the sentence an auditor needs", async () => {
    await post({ repo: "acme/billing", grantedTier: "T3", mode: "agents-allowed" });

    const [action, org, meta, actor] = mockAudit.mock.calls[0]!;
    expect(action).toBe("org.admission");
    expect(org).toBe("acme");
    expect(actor).toBe("octocat");
    expect(meta).toMatchObject({ repo: "acme/billing", grantedTier: "T3", derivedTier: "T1" });
    // "granted T3 where the scan derived T1" is unreconstructible from the grant alone.
    expect((meta as { status: string }).status).toContain("overrides derived T1");
  });

  it("refuses a decision nobody can be named for", async () => {
    // An override with no author is a measurement with a different value, not a decision — which is
    // exactly the confusion this table exists to end.
    mockLogin.mockResolvedValue(null);
    const res = await post({ repo: "acme/billing", grantedTier: "T3", mode: "agents-allowed" });
    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses another tenant's repository", async () => {
    const res = await post({ repo: "othertenant/secrets", grantedTier: "T3", mode: "agents-allowed" });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("validates the two string unions rather than storing what it was handed", async () => {
    expect((await post({ repo: "acme/billing", grantedTier: "T9", mode: "blocked" })).status).toBe(400);
    expect((await post({ repo: "acme/billing", grantedTier: "T0", mode: "anything-goes" })).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("propagates the owner gate's own refusal untouched", async () => {
    const { NextResponse } = await import("next/server");
    mockOwnerPost.mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 403 }) as never);
    const res = await POST(new Request("http://localhost/api/org/admission", { method: "POST" }));
    expect(res.status).toBe(403);
  });
});
