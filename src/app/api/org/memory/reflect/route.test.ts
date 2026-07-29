// Route test for /api/org/memory/reflect — the END-TO-END path by which the `summary` memory kind
// becomes reachable.
//
// WHY THIS FILE EXISTS: reflect was fully implemented and structurally dead. `resolveRunPrompt` returned
// null in production, reflect has no heuristic fallback BY DESIGN, so `proposeReflections` returned []
// in every deployment and no `summary` row could ever be created. This pins the whole chain now that a
// hosted provider can answer: working set → clustering → model → hardened proposal → explicit apply →
// applyReflection writing the summary. The engine is mocked at the seam (resolveMemoryRunner), never
// spawned or called over the network; the clustering and proposal-hardening cores run FOR REAL.
//
// It also pins the distinction the UI depends on: "no engine available" (llmUnavailable) is not the
// same fact as "nothing to consolidate" (clusterCount 0), and the response must let a caller tell them
// apart.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const {
  mockIsDbConfigured,
  mockLifecycleWorkingSet,
  mockApplyReflection,
  mockArchiveOrgMemories,
  mockGetCreditState,
  mockWorkspaceAllowsMemory,
  mockGetOrgId,
  mockRecordAudit,
  mockRequireOrgAccess,
  mockResolveViewerLogin,
  mockResolveMemoryRunner,
  MockMembersNotFound,
} = vi.hoisted(() => {
  class MockMembersNotFound extends Error {}
  return {
    mockIsDbConfigured: vi.fn(),
    mockLifecycleWorkingSet: vi.fn(),
    mockApplyReflection: vi.fn(),
    mockArchiveOrgMemories: vi.fn(),
    mockGetCreditState: vi.fn(),
    mockWorkspaceAllowsMemory: vi.fn(),
    mockGetOrgId: vi.fn(),
    mockRecordAudit: vi.fn(),
    mockRequireOrgAccess: vi.fn(),
    mockResolveViewerLogin: vi.fn(),
    mockResolveMemoryRunner: vi.fn(),
    MockMembersNotFound,
  };
});

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  lifecycleWorkingSet: mockLifecycleWorkingSet,
  applyReflection: mockApplyReflection,
  archiveOrgMemories: mockArchiveOrgMemories,
  getCreditState: mockGetCreditState,
  workspaceAllowsMemory: mockWorkspaceAllowsMemory,
  getOrgId: mockGetOrgId,
  recordAudit: mockRecordAudit,
  ReflectionMembersNotFoundError: MockMembersNotFound,
}));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: mockRequireOrgAccess }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));
vi.mock("@/lib/memory/consolidation-engine", () => ({ resolveMemoryRunner: mockResolveMemoryRunner }));

import { POST } from "./route";

/** Three memories about ONE incident — they clear the real 0.30 Jaccard threshold pairwise. */
const row = (id: string, content: string) => ({
  id,
  content,
  kind: "episodic",
  confidence: 0.8,
  namespace: "infra",
  updatedAt: "2026-07-01T00:00:00.000Z",
  accessCount: 0,
});
const WORKING = [
  row("m1", "deploy pipeline failed on staging because the migration lock timed out"),
  row("m2", "deploy pipeline failed again on staging, migration lock timed out once more"),
  row("m3", "staging deploy pipeline migration lock timed out and failed the release"),
];

const post = (body: unknown) =>
  POST(new Request("http://t/api/org/memory/reflect", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgAccess.mockResolvedValue(null);
  mockGetCreditState.mockResolvedValue({ plan: "team" });
  mockWorkspaceAllowsMemory.mockResolvedValue(true);
  mockResolveViewerLogin.mockResolvedValue("kazimi66");
  mockGetOrgId.mockResolvedValue("org_1");
  mockLifecycleWorkingSet.mockResolvedValue(WORKING);
  mockRecordAudit.mockResolvedValue(undefined);
});

describe("POST /api/org/memory/reflect — the summary kind, end to end", () => {
  it("proposes a rollup through a HOSTED provider (the path that was null in production)", async () => {
    const run = vi.fn(async () =>
      JSON.stringify({
        proposals: [
          {
            clusterId: "m1",
            summaryContent: "Staging deploys repeatedly failed when the migration lock timed out.",
            memberIds: ["m1", "m2", "m3"],
            confidence: 0.7,
          },
        ],
      }),
    );
    mockResolveMemoryRunner.mockResolvedValue({ run, engine: "gemini", model: "gemini-3-flash-preview" });

    const res = await post({ org: "acme" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(run).toHaveBeenCalledTimes(1); // ONE model pass, not one per cluster
    expect(body.llmUnavailable).toBe(false);
    expect(body.engine).toBe("gemini");
    expect(body.clusterCount).toBe(1);
    expect(body.consideredCount).toBe(3);
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].memberIds).toEqual(["m1", "m2", "m3"]);
    // Confidence is capped at the members' own maximum — a rollup can't out-trust its sources.
    expect(body.proposals[0].confidence).toBeLessThanOrEqual(0.8);
    // The members are joined back so the UI can show WHAT would be superseded.
    expect(body.proposals[0].members.map((m: { id: string }) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("applies a proposal, which is what actually WRITES the summary-kind memory", async () => {
    mockResolveMemoryRunner.mockResolvedValue(null); // apply never touches the model
    mockApplyReflection.mockResolvedValue({ id: "sum_1", superseded: 3 });

    const res = await post({
      org: "acme",
      apply: {
        summaryContent: "Staging deploys repeatedly failed when the migration lock timed out.",
        memberIds: ["m1", "m2", "m3"],
        confidence: 0.7,
        namespace: "infra",
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "sum_1", superseded: 3 });
    expect(mockApplyReflection).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ memberIds: ["m1", "m2", "m3"], confidence: 0.7, namespace: "infra" }),
      "kazimi66",
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      "org_memory.reflected",
      expect.objectContaining({ memoryId: "sum_1", superseded: 3 }),
      expect.anything(),
    );
  });

  it("distinguishes NO ENGINE from nothing-to-consolidate", async () => {
    mockResolveMemoryRunner.mockResolvedValue(null);
    const noEngine = await (await post({ org: "acme" })).json();
    // A family WAS found; we simply could not look at it. Silence, not a fabricated rollup.
    expect(noEngine).toMatchObject({ llmUnavailable: true, engine: "none", clusterCount: 1 });
    expect(noEngine.proposals).toEqual([]);

    mockResolveMemoryRunner.mockResolvedValue({ run: vi.fn(), engine: "gemini", model: "m" });
    mockLifecycleWorkingSet.mockResolvedValue([WORKING[0]]);
    const nothing = await (await post({ org: "acme" })).json();
    // The engine was available; there was just no family of three. Different fact, different copy.
    expect(nothing).toMatchObject({ llmUnavailable: false, clusterCount: 0 });
    expect(nothing.proposals).toEqual([]);
  });

  it("degrades to no proposals (never a 500) when the provider throws", async () => {
    mockResolveMemoryRunner.mockResolvedValue({
      run: vi.fn(async () => {
        throw new Error("Gemini request timed out.");
      }),
      engine: "gemini",
      model: "m",
    });
    const res = await post({ org: "acme" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ llmUnavailable: true, engine: "none", proposals: [] });
  });

  it("still gates on the plan before spending a model call", async () => {
    mockWorkspaceAllowsMemory.mockResolvedValue(false);
    const res = await post({ org: "acme" });
    expect(res.status).toBe(403);
    expect(mockResolveMemoryRunner).not.toHaveBeenCalled();
  });
});
