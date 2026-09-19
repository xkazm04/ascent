// Context Health reads the SAME fleet its sibling leaderboard does.
//
// RepositoriesTab resolves org scope once and hands the promise to both panels. This lens used to
// call `getOrgRollup(slug)` with no scope at all, then later honoured `?stack=` while still ignoring
// `?segment=` — so selecting a segment narrowed the table and left the context lens describing a
// different fleet. It also meant the tab ran TWO full rollups per render.
//
// No DOM: the component is a server function, and the assertion is about which fleet it asks for, so
// these tests call it directly and read the recorded arguments.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OrgScope } from "@/lib/org/scope";

const { mockRollup } = vi.hoisted(() => ({ mockRollup: vi.fn() }));

vi.mock("@/lib/db", () => ({ getOrgRollupShared: mockRollup }));

import { ContextHealthPanel } from "./ContextHealthPanel";

function scope(over: Partial<Pick<OrgScope, "segmentId" | "techGroupId">> = {}): Promise<OrgScope> {
  const segmentId = over.segmentId ?? null;
  const techGroupId = over.techGroupId ?? null;
  return Promise.resolve({
    segments: [],
    activeSegment: null,
    segmentId,
    techGroups: [],
    activeStack: null,
    techGroupId,
    barProps: { segments: [], segmentId, techGroups: [], activeStack: null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // An empty fleet short-circuits to the empty state AFTER the fetch, so the call is still recorded
  // and these tests never have to build a full OrgRepoRow.
  mockRollup.mockResolvedValue({ repos: [] });
});

describe("ContextHealthPanel — fleet scope", () => {
  it("threads the tab's resolved ?segment= and ?stack= into the rollup it reads", async () => {
    await ContextHealthPanel({ slug: "acme", scope: scope({ segmentId: "s1", techGroupId: "tg_1" }) });

    // Same four arguments the leaderboard passes — so the two panels describe one repo set, and the
    // request-scoped reader collapses them into a single read.
    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, "s1", "tg_1");
  });

  it("reads the whole fleet when no segment or stack is selected", async () => {
    await ContextHealthPanel({ slug: "acme", scope: scope() });

    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, null, null);
  });

  it("asks for the fleet exactly ONCE per render", async () => {
    await ContextHealthPanel({ slug: "acme", scope: scope({ segmentId: "s1" }) });

    expect(mockRollup).toHaveBeenCalledTimes(1);
  });
});
