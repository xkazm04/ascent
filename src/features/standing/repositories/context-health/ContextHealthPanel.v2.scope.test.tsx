import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OrgScope } from "@/lib/org/scope";

const { mockRollup } = vi.hoisted(() => ({ mockRollup: vi.fn() }));
vi.mock("@/lib/db", () => ({ getOrgRollupShared: mockRollup }));

import { ContextHealthPanelV2 } from "./ContextHealthPanel.v2";

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

describe("ContextHealthPanelV2 fleet scope", () => {
  it("threads segment and stack into the same rollup call", async () => {
    await ContextHealthPanelV2({ slug: "acme", scope: scope({ segmentId: "s1", techGroupId: "tg_1" }) });
    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, "s1", "tg_1");
    expect(mockRollup).toHaveBeenCalledTimes(1);
  });

  it("reads the whole fleet when no scope is selected", async () => {
    await ContextHealthPanelV2({ slug: "acme", scope: scope() });
    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, null, null);
  });
});
