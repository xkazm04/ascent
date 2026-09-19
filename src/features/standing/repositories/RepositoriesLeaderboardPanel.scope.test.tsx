// @vitest-environment jsdom
//
// The Repositories leaderboard honours the same SegmentSelector the rest of the tab uses.
// RepositoriesTab resolves org scope once and hands the promise here; this panel must thread
// that segment into the rollup AND render ScopeFilterBar (not a second, local filter).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrgScope } from "@/lib/org/scope";

const { mockRollup, mockMissing } = vi.hoisted(() => ({
  mockRollup: vi.fn(),
  mockMissing: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getOrgRollupShared: mockRollup, listMissingRepos: mockMissing }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("./MissingReposPanel", () => ({ MissingReposPanel: () => null }));
vi.mock("./RepoLeaderboard", () => ({ RepoLeaderboard: () => <div data-testid="leaderboard" /> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/org/acme",
  useSearchParams: () => new URLSearchParams("tab=repositories&segment=s1"),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { RepositoriesLeaderboardPanel } from "./RepositoriesLeaderboardPanel";

const segments = [{ id: "s1", name: "Platform", color: "#3b9eff", repoCount: 2, createdAt: "x" }];

function scope(over: Partial<OrgScope> = {}): Promise<OrgScope> {
  const segmentId = over.segmentId === undefined ? "s1" : over.segmentId;
  const techGroups = over.techGroups ?? [];
  const activeStack = over.activeStack ?? null;
  const segs = over.segments ?? segments;
  return Promise.resolve({
    segments: segs,
    activeSegment: segs.find((s) => s.id === segmentId) ?? null,
    segmentId,
    techGroups,
    activeStack,
    techGroupId: over.techGroupId ?? null,
    barProps: { segments: segs, segmentId, techGroups, activeStack },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMissing.mockResolvedValue([]);
  mockRollup.mockResolvedValue({
    org: "acme",
    repoCount: 1,
    scannedCount: 1,
    repos: [
      {
        fullName: "acme/web",
        name: "web",
        watched: true,
        scanSchedule: "off",
        lastScanStatus: null,
        lastScanError: null,
        aiConformance: null,
        techStack: null,
        activity: null,
        latest: { overall: 70, posture: "ungoverned", level: "L3", adoption: 60, rigor: 80, scannedAt: "2026-09-01" },
      },
    ],
  });
});

describe("RepositoriesLeaderboardPanel — segment scope", () => {
  it("threads the tab's resolved ?segment= into the rollup it reads", async () => {
    await RepositoriesLeaderboardPanel({ slug: "acme", sp: { segment: "s1" }, scope: scope() });

    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, "s1", null);
  });

  it("composes segment AND stack on the same rollup call the Context Health lens uses", async () => {
    await RepositoriesLeaderboardPanel({
      slug: "acme",
      sp: { segment: "s1", stack: "node" },
      scope: scope({ techGroupId: "tg_1", activeStack: { id: "tg_1", key: "node", label: "Node", repoCount: 1 } }),
    });

    expect(mockRollup).toHaveBeenCalledWith("acme", undefined, "s1", "tg_1");
  });

  it("renders the shared SegmentSelector with the active segment pressed", async () => {
    render(await RepositoriesLeaderboardPanel({ slug: "acme", sp: { segment: "s1" }, scope: scope() }));

    expect(screen.getByRole("button", { name: /Platform/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /All repos/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps ?segment= on the posture chips so picking a posture does not drop the filter", async () => {
    render(await RepositoriesLeaderboardPanel({ slug: "acme", sp: { segment: "s1" }, scope: scope() }));

    const all = screen.getByRole("link", { name: /^All/ });
    expect(all.getAttribute("href")).toContain("segment=s1");
    expect(screen.getByRole("link", { name: /Ungoverned/ }).getAttribute("href")).toContain("segment=s1");
  });
});
