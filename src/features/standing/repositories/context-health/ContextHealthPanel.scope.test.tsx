// Context Health reads the SAME fleet its sibling leaderboard does.
//
// The panel used to call `getOrgRollup(slug)` with no scope at all while RepositoriesLeaderboardPanel
// two elements above it called `getOrgRollup(slug, undefined, null, techGroupId)` — so selecting a
// tech stack narrowed the table and left the context lens below it describing the whole fleet, with
// nothing on screen saying the two panels disagreed. It also meant the tab ran TWO full rollups per
// render.
//
// No DOM: the component is a server function, and the assertion is about which fleet it asks for, so
// these tests call it directly and read the recorded arguments.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockRollup, mockResolveStackScope } = vi.hoisted(() => ({
  mockRollup: vi.fn(),
  mockResolveStackScope: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getOrgRollupShared: mockRollup }));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: mockResolveStackScope }));

import { ContextHealthPanel } from "./ContextHealthPanel";

beforeEach(() => {
  vi.clearAllMocks();
  // An empty fleet short-circuits to the empty state AFTER the fetch, so the call is still recorded
  // and these tests never have to build a full OrgRepoRow.
  mockRollup.mockResolvedValue({ repos: [] });
});

describe("ContextHealthPanel — fleet scope", () => {
  it("threads the resolved ?stack= group into the rollup it reads", async () => {
    mockResolveStackScope.mockResolvedValue({ techGroups: [], activeStack: { key: "node", id: "tg_1" }, techGroupId: "tg_1" });

    await ContextHealthPanel({ slug: "acme", sp: { stack: "node" } });

    expect(mockResolveStackScope).toHaveBeenCalledWith("acme", { stack: "node" });
    // Same four arguments the leaderboard passes — so the two panels describe one repo set, and the
    // request-scoped reader collapses them into a single read.
    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, null, "tg_1");
  });

  it("reads the whole fleet when no stack is selected", async () => {
    mockResolveStackScope.mockResolvedValue({ techGroups: [], activeStack: null, techGroupId: null });

    await ContextHealthPanel({ slug: "acme", sp: {} });

    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, null, null);
  });

  it("asks for the fleet exactly ONCE per render", async () => {
    mockResolveStackScope.mockResolvedValue({ techGroups: [], activeStack: null, techGroupId: null });

    await ContextHealthPanel({ slug: "acme", sp: {} });

    expect(mockRollup).toHaveBeenCalledTimes(1);
  });
});
