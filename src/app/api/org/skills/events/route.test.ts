// Route test for POST /api/org/skills/events — the WIRE contract of telemetry sink A (#19).
//
// What this file owns is the shape the route lets through: which `type` values survive validation,
// which optional fields reach the writer verbatim, and the order of the gates (DB -> body -> authz).
// The writer's own invariants (source normalization, the `ts` clamp, dedupe, the tenant filter) are
// pinned against a mocked Prisma in src/lib/db/org-skills-sync.test.ts — testing them twice through
// the route would only re-assert the mock.
//
// `isSkillEventType` runs REAL (it is the union under test); only the DB write and the identity check
// are mocked. next/server is faked as a Response subclass, matching the sibling route tests.

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

const { mockIsDbConfigured, mockRecordSkillEvents, mockAuthorizeOrgApi } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockRecordSkillEvents: vi.fn(),
  mockAuthorizeOrgApi: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, isDbConfigured: mockIsDbConfigured, recordSkillEvents: mockRecordSkillEvents };
});
vi.mock("@/lib/api-token-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-token-auth")>();
  return { ...actual, authorizeOrgApi: mockAuthorizeOrgApi };
});

import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://t/api/org/skills/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockAuthorizeOrgApi.mockResolvedValue({ orgSlug: "acme" });
  mockRecordSkillEvents.mockResolvedValue({ recorded: 1 });
});

describe("POST /api/org/skills/events", () => {
  it("accepts `invoke` and passes it to the writer", async () => {
    // FAIL-BEFORE: `invoke` was not in the union, so this batch had every event filtered out and the
    // route answered 400 "type must be download|sync" — the retirement that made `active` unreachable.
    const res = await POST(post({ org: "acme", events: [{ skillId: "s1", type: "invoke" }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 1 });
    expect(mockRecordSkillEvents).toHaveBeenCalledWith("acme", [
      expect.objectContaining({ skillId: "s1", type: "invoke" }),
    ]);
  });

  it("carries session, ts, repo and source through to the writer untouched", async () => {
    // The route deliberately does NOT normalize `source`: the closed vocabulary lives in one place
    // (recordSkillEvents -> normalizeEventSource), so a second route can never disagree with it.
    const ts = "2026-08-01T10:00:00.000Z";
    await POST(
      post({
        org: "acme",
        events: [{ skillId: "s1", type: "invoke", repo: "acme/app", source: "cli:diverged", session: "sess", ts }],
      }),
    );
    expect(mockRecordSkillEvents).toHaveBeenCalledWith("acme", [
      { skillId: "s1", type: "invoke", repo: "acme/app", source: "cli:diverged", session: "sess", ts },
    ]);
  });

  it("nulls the optional fields a producer omitted rather than inventing them", async () => {
    await POST(post({ org: "acme", events: [{ skillId: "s1", type: "download" }] }));
    expect(mockRecordSkillEvents).toHaveBeenCalledWith("acme", [
      { skillId: "s1", type: "download", repo: null, source: null, session: null, ts: null },
    ]);
  });

  it("keeps the valid events of a mixed batch and drops only the unknown types", async () => {
    await POST(
      post({
        org: "acme",
        events: [
          { skillId: "s1", type: "invoke" },
          { skillId: "s2", type: "teleport" },
          { skillId: "s3", type: "sync" },
        ],
      }),
    );
    const sent = mockRecordSkillEvents.mock.calls[0]![1] as { skillId: string }[];
    expect(sent.map((e) => e.skillId)).toEqual(["s1", "s3"]);
  });

  it("400s a batch with no valid event, naming all three types", async () => {
    const res = await POST(post({ org: "acme", events: [{ skillId: "s1", type: "teleport" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("invoke|download|sync");
    expect(mockRecordSkillEvents).not.toHaveBeenCalled();
  });

  it("caps the batch at 500 events", async () => {
    const events = Array.from({ length: 600 }, (_, i) => ({ skillId: `s${i}`, type: "invoke" }));
    await POST(post({ org: "acme", events }));
    expect((mockRecordSkillEvents.mock.calls[0]![1] as unknown[]).length).toBe(500);
  });

  it("requires the org and a non-empty events array before it authorizes anything", async () => {
    expect((await POST(post({ events: [{ skillId: "s1", type: "invoke" }] }))).status).toBe(400);
    expect((await POST(post({ org: "acme", events: [] }))).status).toBe(400);
    expect(mockAuthorizeOrgApi).not.toHaveBeenCalled();
  });

  it("gates on telemetry:write and never writes when denied", async () => {
    const denied = new Response("no", { status: 403 });
    mockAuthorizeOrgApi.mockResolvedValue({ denied });
    const res = await POST(post({ org: "acme", events: [{ skillId: "s1", type: "invoke" }] }));
    expect(res.status).toBe(403);
    expect(mockAuthorizeOrgApi).toHaveBeenCalledWith(expect.anything(), "acme", {
      scope: "telemetry:write",
      mode: "write",
    });
    expect(mockRecordSkillEvents).not.toHaveBeenCalled();
  });

  it("503s without a database", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect((await POST(post({ org: "acme", events: [{ skillId: "s1", type: "invoke" }] }))).status).toBe(503);
  });
});
