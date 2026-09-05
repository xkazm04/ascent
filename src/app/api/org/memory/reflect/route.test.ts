// Route test for POST /api/org/memory/reflect (#36) — the two WRITE branches.
//
// The load-bearing one is the origin refusal. Applying a reflection over registry-origin members
// used to succeed and then be silently reverted by the next index pass: a write that reports success
// and does not survive is worse than a refusal, because nobody goes looking for it.
//
// The propose path is the honest alternative and is asserted end to end: the PR opens, the proposal
// row is stamped, and the audit row records who asked.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDb: vi.fn(() => true),
  access: vi.fn(),
  allows: vi.fn(),
  credit: vi.fn(),
  orgId: vi.fn(),
  viewer: vi.fn(),
  apply: vi.fn(),
  audit: vi.fn(),
  working: vi.fn(),
  archive: vi.fn(),
  runner: vi.fn(),
  propose: vi.fn(),
  members: vi.fn(),
  registry: vi.fn(),
  write: vi.fn(),
  createProposal: vi.fn(),
  setPr: vi.fn(),
  pr: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDb,
  applyReflection: h.apply,
  archiveOrgMemories: h.archive,
  getCreditState: h.credit,
  getOrgId: h.orgId,
  lifecycleWorkingSet: h.working,
  recordAudit: h.audit,
  workspaceAllowsMemory: h.allows,
  // Declared inside the factory: vi.mock is hoisted above every top-level binding, so a class
  // defined outside it is not yet initialized when the factory runs.
  ReflectionMembersNotFoundError: class MembersNotFound extends Error {},
}));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: h.access }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.viewer }));
vi.mock("@/lib/memory/consolidation-engine", () => ({ resolveMemoryRunner: h.runner }));
vi.mock("@/lib/memory/reflection", () => ({ proposeReflections: h.propose }));
vi.mock("@/lib/memory/decay", () => ({ archiveDecayed: vi.fn() }));
vi.mock("@/lib/db/org-registry-proposals", () => ({
  resolveProposalMembers: h.members,
  createMemoryProposal: h.createProposal,
  setMemoryProposalPr: h.setPr,
}));
vi.mock("@/lib/db/org-registry", () => ({ getOrgRegistry: h.registry }));
vi.mock("@/lib/registry/api", () => ({ guardRegistryWrite: h.write }));
vi.mock("@/lib/registry/memory-pr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registry/memory-pr")>();
  return { ...actual, proposeMemoryPr: h.pr };
});

import { NextResponse } from "next/server";
import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://t/api/org/memory/reflect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const member = (id: string, origin: "hosted" | "registry", path: string | null = null) => ({
  id,
  origin,
  registryPath: path,
  registryId: origin === "registry" ? "reg-1" : null,
  namespace: "acme/api",
  kind: "decision",
});

const APPLY = { summaryContent: "one rollup", memberIds: ["m1", "m2"] };

beforeEach(() => {
  vi.clearAllMocks();
  h.isDb.mockReturnValue(true);
  h.access.mockResolvedValue(null);
  h.allows.mockResolvedValue(true);
  h.credit.mockResolvedValue({ plan: "team" });
  h.orgId.mockResolvedValue("org-1");
  h.viewer.mockResolvedValue("owner-login");
  h.apply.mockResolvedValue({ id: "sum-1", superseded: 2 });
  h.members.mockResolvedValue([member("m1", "hosted"), member("m2", "hosted")]);
  h.registry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main" });
  h.write.mockResolvedValue({ token: "tok", capabilities: {} });
  h.createProposal.mockResolvedValue({ id: "prop-1" });
  h.pr.mockResolvedValue({ ok: true, url: "https://github.com/acme/ai-registry/pull/7", number: 7, branch: "b", path: "memory/summary/s.md", reused: false });
  h.working.mockResolvedValue([]);
  h.propose.mockResolvedValue({ proposals: [], clusterCount: 0, llmUnavailable: false, engine: null });
  h.runner.mockResolvedValue(null);
});

describe("apply · the registry-origin refusal", () => {
  it("REFUSES an apply whose members are registry mirrors", async () => {
    // FAIL-BEFORE: this succeeded, wrote supersededBy, and the next index pass reverted it —
    // a write that reports success and does not survive.
    h.members.mockResolvedValue([member("m1", "registry", "memory/decision/a.md"), member("m2", "hosted")]);
    const res = await POST(post({ org: "acme", apply: APPLY }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("registry-origin");
    expect(body.memberIds).toEqual(["m1"]);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("names the path that DOES work in the refusal", async () => {
    h.members.mockResolvedValue([member("m1", "registry", "memory/decision/a.md"), member("m2", "hosted")]);
    const body = await (await POST(post({ org: "acme", apply: APPLY }))).json();
    expect(body.error).toContain("propose a pull request instead");
  });

  it("is byte-identical to before for a hosted-only apply", async () => {
    const res = await POST(post({ org: "acme", apply: { ...APPLY, confidence: 0.8, namespace: "n" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "sum-1", superseded: 2 });
    expect(h.apply).toHaveBeenCalledWith(
      "acme",
      { summaryContent: "one rollup", memberIds: ["m1", "m2"], confidence: 0.8, namespace: "n" },
      "owner-login",
    );
    expect(h.audit).toHaveBeenCalledWith(
      "org_memory.reflected",
      { memoryId: "sum-1", superseded: 2, memberIds: ["m1", "m2"] },
      { orgId: "org-1", actorId: "owner-login" },
    );
  });

  it("still 400s a body with fewer than two members", async () => {
    expect((await POST(post({ org: "acme", apply: { summaryContent: "x", memberIds: ["m1"] } }))).status).toBe(400);
  });
});

describe("proposePr", () => {
  const body = { org: "acme", proposePr: { summaryContent: "one rollup", memberIds: ["m1", "m2"] } };

  beforeEach(() => {
    h.members.mockResolvedValue([
      member("m1", "registry", "memory/decision/a.md"),
      member("m2", "registry", "memory/decision/b.md"),
    ]);
  });

  it("opens the PR, stamps the proposal and records the audit row", async () => {
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ proposalId: "prop-1", number: 7, supersedes: ["memory/decision/a.md", "memory/decision/b.md"] });
    expect(h.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", registryId: "reg-1", createdBy: "owner-login", memberPaths: ["memory/decision/a.md", "memory/decision/b.md"] }),
    );
    expect(h.setPr).toHaveBeenCalledWith("prop-1", { url: "https://github.com/acme/ai-registry/pull/7", number: 7 });
    expect(h.audit).toHaveBeenCalledWith(
      "org_memory.pr_proposed",
      expect.objectContaining({ proposalId: "prop-1", prUrl: "https://github.com/acme/ai-registry/pull/7" }),
      { orgId: "org-1", actorId: "owner-login" },
    );
  });

  it("writes the proposal row BEFORE the GitHub call and keeps it when the PR fails", async () => {
    h.pr.mockResolvedValue({ ok: false, reason: "`memory/summary/s.md` already exists — won't overwrite it.", status: 409 });
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect(h.createProposal).toHaveBeenCalled();
    // No outcome is stamped onto a publish that never happened; the row stays at `proposed`.
    expect(h.setPr).not.toHaveBeenCalled();
  });

  it("rejects a member id from another org — the resolve is org-scoped", async () => {
    h.members.mockResolvedValue([member("m1", "registry", "memory/decision/a.md")]);
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not live memories in this organization");
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("409s when none of the members are mirrored — there is nothing to supersede", async () => {
    h.members.mockResolvedValue([member("m1", "hosted"), member("m2", "hosted")]);
    const res = await POST(post(body));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no-registry-members");
  });

  it("409s when no registry is mapped", async () => {
    h.registry.mockResolvedValue(null);
    expect((await POST(post(body))).status).toBe(409);
  });

  it("takes the member-floor write gate's refusal verbatim", async () => {
    h.write.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    expect((await POST(post(body))).status).toBe(403);
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("gates on the same member floor the re-index route uses, not admin", async () => {
    await POST(post(body));
    expect(h.write).toHaveBeenCalledWith("acme", { minRole: "member" });
  });

  it("400s a body with fewer than two members", async () => {
    const res = await POST(post({ org: "acme", proposePr: { summaryContent: "x", memberIds: ["m1"] } }));
    expect(res.status).toBe(400);
  });
});

describe("gates shared by both branches", () => {
  it("503s without a database", async () => {
    h.isDb.mockReturnValue(false);
    expect((await POST(post({ org: "acme", apply: APPLY }))).status).toBe(503);
  });

  it("403s an org without the memory entitlement", async () => {
    h.allows.mockResolvedValue(false);
    expect((await POST(post({ org: "acme", proposePr: APPLY }))).status).toBe(403);
  });
});
