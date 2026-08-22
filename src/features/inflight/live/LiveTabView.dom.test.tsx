// @vitest-environment jsdom
//
// The Live tab now has TWO views, and the cockpit must not have eaten either of the wall's two entry
// points. `?view=wall` still renders exactly the wall (autopilot band included), and the kiosk route
// — a capability-link surface with no session — still renders LiveWarRoom read-only with no cockpit
// anywhere near it. Both are asserted by rendering, not by reading imports.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const repo = { fullName: "acme/one", name: "one", watched: true, lastScanStatus: "ok", lastScanError: null, latest: { overall: 60, adoption: 55, rigor: 65, level: "L3", posture: "manual", scannedAt: "2026-08-22T10:00:00Z" } };
const rollup = { repos: [repo], repoCount: 1, trend: [], deltas: null };

vi.mock("@/lib/org/scope", () => ({ resolveStackScope: async () => ({ techGroups: [], activeStack: null, techGroupId: null }) }));
vi.mock("@/lib/db", () => ({
  getOrgRollup: async () => rollup,
  getOrgRepoHistories: async () => [],
  listGoals: async () => [],
  listOpsState: async () => null,
  listLocalPairings: async () => [{ fullName: "acme/one", localPath: "C:/code/one" }],
  isDbConfigured: () => true,
}));
vi.mock("@/lib/db/loop-runs", () => ({ getActiveLoopRun: async () => null, listLoopRuns: async () => [] }));
vi.mock("@/lib/db/org-share", () => ({ isLiveShareRevoked: async () => false }));
vi.mock("@/lib/db/members", () => ({ getMembershipRole: async () => "owner", roleAtLeast: () => true }));
vi.mock("@/lib/env", () => ({ selfHosted: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => true }));
vi.mock("@/lib/live-share", () => ({
  liveShareEnabled: () => false,
  verifyLiveShareToken: () => ({ org: "acme", jti: "j1", mintedBy: null }),
}));
vi.mock("./LiveWarRoom", () => ({ LiveWarRoom: (p: { readOnly?: boolean }) => <div data-testid="war-room">{p.readOnly ? "read-only" : "live"}</div> }));
vi.mock("@/features/inflight/live/LiveWarRoom", () => ({
  LiveWarRoom: (p: { readOnly?: boolean }) => <div data-testid="war-room">{p.readOnly ? "read-only" : "live"}</div>,
}));
vi.mock("./cockpit", () => ({ LiveCockpit: (p: { wallHref: string }) => <div data-testid="cockpit">{p.wallHref}</div> }));
vi.mock("./AutopilotBand", () => ({ AutopilotBand: () => <div data-testid="autopilot-band" /> }));

const { LiveTab } = await import("./LiveTab");
const { default: SharedLivePage } = await import("@/app/live/shared/[token]/page");

describe("LiveTab view routing", () => {
  it("renders the cockpit by default, with a wall link that keeps the tab's params", async () => {
    render(await LiveTab({ slug: "acme", sp: { tab: "live", stack: "frontend" } }));
    const cockpit = screen.getByTestId("cockpit");
    expect(cockpit).toBeInTheDocument();
    expect(cockpit.textContent).toContain("view=wall");
    expect(cockpit.textContent).toContain("stack=frontend");
    expect(screen.queryByTestId("war-room")).not.toBeInTheDocument();
  });

  it("renders exactly today's wall tree under ?view=wall", async () => {
    render(await LiveTab({ slug: "acme", sp: { tab: "live", view: "wall" } }));
    expect(screen.getByTestId("war-room")).toHaveTextContent("live");
    expect(screen.getByTestId("autopilot-band")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit")).not.toBeInTheDocument();
  });
});

describe("the kiosk share route", () => {
  it("still renders LiveWarRoom read-only, with no cockpit", async () => {
    render(await SharedLivePage({ params: Promise.resolve({ token: "t" }) }));
    expect(screen.getByTestId("war-room")).toHaveTextContent("read-only");
    expect(screen.queryByTestId("cockpit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("autopilot-band")).not.toBeInTheDocument();
  });
});
