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
  mockRollup.mockResolvedValue({ repos: [] });
});

describe("ContextHealthPanel fleet scope", () => {
  it("threads segment and stack into the same rollup call", async () => {
    await ContextHealthPanel({ slug: "acme", scope: scope({ segmentId: "s1", techGroupId: "tg_1" }) });
    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, "s1", "tg_1");
    expect(mockRollup).toHaveBeenCalledTimes(1);
  });

  it("reads the whole fleet when no scope is selected", async () => {
    await ContextHealthPanel({ slug: "acme", scope: scope() });
    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, null, null);
  });
});
