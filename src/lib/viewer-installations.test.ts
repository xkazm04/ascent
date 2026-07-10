// /launch read installations off the dormant custom-OAuth session. Under the Supabase wall that session
// is never minted, so the page's `if (!session)` was always true and its inner
// `if (!isAuthConfigured()) redirect("/connect")` was too — the page was unreachable for EVERY visitor.
// These tests pin the production shape: a Supabase viewer's installations come from their org
// memberships, and an org whose App installation is gone is dropped rather than charted.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetSession, mockGetViewer, mockListOrgs, mockInstallForOwner } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetViewer: vi.fn(),
  mockListOrgs: vi.fn(),
  mockInstallForOwner: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mockGetSession }));
vi.mock("@/lib/access", () => ({ getViewer: mockGetViewer }));
vi.mock("@/lib/db", () => ({ getInstallationIdForOwner: mockInstallForOwner }));
vi.mock("@/lib/db/members", () => ({ listOrgsForLogin: mockListOrgs }));

import { viewerInstallations, viewerDisplayName } from "./viewer-installations";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockGetViewer.mockResolvedValue(null);
  mockListOrgs.mockResolvedValue([]);
  mockInstallForOwner.mockResolvedValue(null);
});

describe("viewerInstallations", () => {
  it("PROD SHAPE: no custom session — derives installations from the Supabase viewer's org memberships", async () => {
    mockGetViewer.mockResolvedValue({ id: "1", login: "alice" });
    mockListOrgs.mockResolvedValue([
      { slug: "acme", name: "Acme", role: "owner" },
      { slug: "beta", name: "Beta", role: "member" },
    ]);
    mockInstallForOwner.mockImplementation(async (slug: string) => (slug === "acme" ? "42" : "77"));

    // Pre-fix this returned nothing and /launch redirected everyone to /connect.
    expect(await viewerInstallations()).toEqual([
      { id: 42, login: "acme" },
      { id: 77, login: "beta" },
    ]);
  });

  it("drops an org whose App installation is gone rather than charting a dead star", async () => {
    mockGetViewer.mockResolvedValue({ id: "1", login: "alice" });
    mockListOrgs.mockResolvedValue([
      { slug: "acme", name: "Acme", role: "owner" },
      { slug: "stale", name: "Stale", role: "owner" },
    ]);
    mockInstallForOwner.mockImplementation(async (slug: string) => (slug === "acme" ? "42" : null));

    expect(await viewerInstallations()).toEqual([{ id: 42, login: "acme" }]);
  });

  it("skips a non-numeric installation id (never keys a constellation on NaN)", async () => {
    mockGetViewer.mockResolvedValue({ id: "1", login: "alice" });
    mockListOrgs.mockResolvedValue([{ slug: "acme", name: "Acme", role: "owner" }]);
    mockInstallForOwner.mockResolvedValue("not-a-number");

    expect(await viewerInstallations()).toEqual([]);
  });

  it("prefers the dormant session's inline installations when that stack is live (no DB queries)", async () => {
    mockGetSession.mockResolvedValue({ login: "u", installations: [{ id: 7, login: "acme" }] });

    expect(await viewerInstallations()).toEqual([{ id: 7, login: "acme" }]);
    expect(mockListOrgs).not.toHaveBeenCalled();
    expect(mockGetViewer).not.toHaveBeenCalled();
  });

  it("an anonymous caller has no installations", async () => {
    expect(await viewerInstallations()).toEqual([]);
  });
});

describe("viewerDisplayName", () => {
  it("falls back across both stacks, and never renders undefined", async () => {
    mockGetSession.mockResolvedValue({ login: "u", name: "Ursula", installations: [] });
    expect(await viewerDisplayName()).toBe("Ursula");

    mockGetSession.mockResolvedValue(null);
    mockGetViewer.mockResolvedValue({ id: "1", login: "alice" });
    expect(await viewerDisplayName()).toBe("alice");

    mockGetViewer.mockResolvedValue(null);
    expect(await viewerDisplayName()).toBe("you");
  });
});
