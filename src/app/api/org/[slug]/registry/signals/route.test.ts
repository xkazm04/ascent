// Route test for POST /api/org/[slug]/registry/signals (#18) — the publication path.
//
// The gates are what this file exists for. Publication reaches a repo the customer may have made
// public, so each of the four refusals is asserted individually, and the audit row's survival across
// a FAILED PR is asserted too: recording only successes would hide exactly the attempts anyone
// would later want to look at.

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
  sameOrigin: vi.fn(),
  write: vi.fn(),
  orgId: vi.fn(),
  registry: vi.fn(),
  spine: vi.fn(),
  contributor: vi.fn(),
  signals: vi.fn(),
  maps: vi.fn(),
  record: vi.fn(),
  setResult: vi.fn(),
  pr: vi.fn(),
  login: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ isSameOrigin: h.sameOrigin }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.login }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: h.orgId }));
vi.mock("@/lib/db/org-registry", () => ({ getOrgRegistry: h.registry }));
vi.mock("@/lib/registry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registry/api")>();
  return { ...actual, guardRegistryWrite: h.write };
});
vi.mock("@/lib/registry/conformance-read", () => ({ readRegistrySpine: h.spine }));
vi.mock("@/lib/db/org-registry-signals", () => ({
  getSignalsContributor: h.contributor,
  listRegistrySignals: h.signals,
  recordSignalContribution: h.record,
  setSignalContributionResult: h.setResult,
}));
vi.mock("@/lib/db/org-registry-conformance", () => ({ listConformanceMaps: h.maps }));
vi.mock("@/lib/registry/signals-pr", () => ({ openOrUpdateSignalsPr: h.pr }));

import { NextResponse } from "next/server";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const post = (body: unknown) =>
  new Request("http://t/api/org/acme/registry/signals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const SPINE = "registry: 1\nlanes:\n  signals: writer\n";

const signalRow = (over: Record<string, unknown> = {}) => ({
  contributor: "someone",
  app: "ascent",
  bundle: "software-engineering",
  subjectSlug: "quality-gates",
  consults: 12,
  deviations: 2,
  citResolved: 5,
  citMoved: 1,
  citGone: 0,
  windowDays: 30,
  generatedAt: "2026-08-29T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.sameOrigin.mockReturnValue(true);
  h.write.mockResolvedValue({ token: "tok", capabilities: {} });
  h.orgId.mockResolvedValue("org-1");
  h.registry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main", telemetrySink: "registry" });
  h.spine.mockResolvedValue(SPINE);
  h.contributor.mockResolvedValue(null);
  h.signals.mockResolvedValue([signalRow()]);
  h.maps.mockResolvedValue([{ deviations: 7 }]);
  h.record.mockResolvedValue("attempt-1");
  h.pr.mockResolvedValue({ url: "https://github.com/acme/ai-registry/pull/3", number: 3, branch: "b", commitSha: "c", reused: false, updated: false });
  h.login.mockResolvedValue("owner-login");
});

describe("the four gates", () => {
  it("publishes when all of them pass", async () => {
    const res = await POST(post({ confirm: "contribute" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ number: 3, subjects: 1 });
  });

  it("refuses a cross-origin request before anything else runs", async () => {
    h.sameOrigin.mockReturnValue(false);
    expect((await POST(post({ confirm: "contribute" }), ctx)).status).toBe(403);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("takes the write gate's refusal verbatim", async () => {
    h.write.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    expect((await POST(post({ confirm: "contribute" }), ctx)).status).toBe(403);
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("400s without the typed confirm", async () => {
    const res = await POST(post({}), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Type "contribute"');
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("refuses when the registry's telemetry sink is not `registry`", async () => {
    h.registry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main", telemetrySink: "api" });
    const res = await POST(post({ confirm: "contribute" }), ctx);
    expect(res.status).toBe(403);
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("refuses when the spine does not declare ascent a writer of the signals lane", async () => {
    h.spine.mockResolvedValue("registry: 1\nlanes:\n  signals: reader\n");
    const res = await POST(post({ confirm: "contribute" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("writer of the `signals` lane");
  });

  it("FAILS CLOSED when the spine cannot be found at all", async () => {
    h.spine.mockResolvedValue(null);
    expect((await POST(post({ confirm: "contribute" }), ctx)).status).toBe(403);
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("re-reads the spine LIVE rather than trusting the indexed row", async () => {
    await POST(post({ confirm: "contribute" }), ctx);
    expect(h.spine).toHaveBeenCalledWith("tok", "acme", "ai-registry");
  });
});

describe("the payload and the audit row", () => {
  it("writes the attempt BEFORE the GitHub call, and keeps it when the PR fails", async () => {
    h.pr.mockRejectedValue(new Error("boom"));
    const res = await POST(post({ confirm: "contribute" }), ctx);
    expect(res.status).toBe(502);
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", registryId: "reg-1", actor: "owner-login", deviations: 7 }),
    );
    // The attempt stays exactly as written — no outcome is stamped onto a publish that never happened.
    expect(h.setResult).not.toHaveBeenCalled();
  });

  it("stamps the PR url onto the attempt when it succeeds", async () => {
    await POST(post({ confirm: "contribute" }), ctx);
    expect(h.setResult).toHaveBeenCalledWith("attempt-1", {
      prUrl: "https://github.com/acme/ai-registry/pull/3",
      commitSha: "c",
    });
  });

  it("publishes counts only — the PR body carries no repo name or path", async () => {
    await POST(post({ confirm: "contribute" }), ctx);
    const call = h.pr.mock.calls[0]![0];
    // The filename is the derived opaque contributor id, not anything the org is called.
    expect(call.path).toMatch(/^signals\/ascent-[0-9a-f]{12}\.json$/);
    expect(call.content).not.toMatch(/src\//);
    expect(call.content).not.toMatch(/acme/);
  });

  it("uses the org's configured contributor id when it has one", async () => {
    h.contributor.mockResolvedValue("acme-fleet");
    await POST(post({ confirm: "contribute" }), ctx);
    expect(h.pr.mock.calls[0]![0].path).toBe("signals/acme-fleet.json");
  });

  it("refuses a configured contributor id that would publish an org name", async () => {
    h.contributor.mockResolvedValue("acme/fleet");
    const res = await POST(post({ confirm: "contribute" }), ctx);
    expect(res.status).toBe(400);
    expect(h.pr).not.toHaveBeenCalled();
  });

  it("409s when nothing has been measured yet rather than publishing an empty claim", async () => {
    h.signals.mockResolvedValue([]);
    const res = await POST(post({ confirm: "contribute" }), ctx);
    expect(res.status).toBe(409);
    expect(h.record).not.toHaveBeenCalled();
  });

  it("409s when no registry is mapped", async () => {
    h.registry.mockResolvedValue(null);
    expect((await POST(post({ confirm: "contribute" }), ctx)).status).toBe(409);
  });
});
