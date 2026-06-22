// Tests for the shared org-scope resolver. listSegments/listTechStackGroups are mocked so this pins the
// resolution + fallback semantics every scoped page now relies on: a valid ?segment=/?stack= resolves
// to its id; a bogus/absent/array value falls back to null (whole fleet); the two compose independently.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockListSegments, mockListTechStackGroups } = vi.hoisted(() => ({
  mockListSegments: vi.fn(),
  mockListTechStackGroups: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ listSegments: mockListSegments, listTechStackGroups: mockListTechStackGroups }));

import { resolveOrgScope, resolveStackScope } from "@/lib/org/scope";

const segs = [{ id: "s1", name: "Platform", color: "#fff", repoCount: 3, createdAt: "x" }];
const groups = [{ id: "g_fe", key: "frontend", label: "Frontend", repoCount: 4 }];

beforeEach(() => {
  vi.clearAllMocks();
  mockListSegments.mockResolvedValue(segs);
  mockListTechStackGroups.mockResolvedValue(groups);
});

describe("resolveStackScope", () => {
  it("resolves a valid ?stack= key to its group id", async () => {
    const r = await resolveStackScope("acme", { stack: "frontend" });
    expect(r.activeStack?.key).toBe("frontend");
    expect(r.techGroupId).toBe("g_fe");
    expect(r.techGroups).toEqual(groups);
  });

  it("falls back to null for a bogus/absent key (whole fleet)", async () => {
    expect((await resolveStackScope("acme", { stack: "nope" })).techGroupId).toBeNull();
    expect((await resolveStackScope("acme", {})).techGroupId).toBeNull();
  });

  it("takes the first value of an array-valued param", async () => {
    expect((await resolveStackScope("acme", { stack: ["frontend", "x"] })).techGroupId).toBe("g_fe");
  });
});

describe("resolveOrgScope", () => {
  it("resolves segment + stack together (the filters compose)", async () => {
    const r = await resolveOrgScope("acme", { segment: "s1", stack: "frontend" });
    expect(r.segmentId).toBe("s1");
    expect(r.activeSegment?.name).toBe("Platform");
    expect(r.techGroupId).toBe("g_fe");
  });

  it("falls back each filter independently on a bogus value", async () => {
    const r = await resolveOrgScope("acme", { segment: "bad", stack: "frontend" });
    expect(r.segmentId).toBeNull();
    expect(r.techGroupId).toBe("g_fe");
  });

  it("tolerates listSegments returning null", async () => {
    mockListSegments.mockResolvedValue(null);
    const r = await resolveOrgScope("acme", {});
    expect(r.segments).toEqual([]);
    expect(r.segmentId).toBeNull();
  });
});
