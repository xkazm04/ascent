// @vitest-environment jsdom
//
// WHICH VIEW THE LIVE TAB OPENS ON. `?view=wall` is the wall, unchanged; an explicit `ledger` or
// `cockpit` always wins; with no view, a standing runner opens the Ledger and its absence the Cockpit.
// Rendered through the real `LiveTab` over mocked db reads — the runner probe is the only thing varied.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { needsRunnerProbe, resolveLiveView } from "./ledgerView";

const h = vi.hoisted(() => ({ runner: false }));
const repo = { fullName: "acme/one", name: "one", watched: true, lastScanStatus: "ok", lastScanError: null, latest: { overall: 60, adoption: 55, rigor: 65, level: "L3", posture: "manual", scannedAt: "2026-08-22T10:00:00Z" } };

vi.mock("@/lib/org/scope", () => ({ resolveStackScope: async () => ({ techGroups: [], activeStack: null, techGroupId: null }) }));
vi.mock("@/lib/db", () => ({
  getOrgRollup: async () => ({ repos: [repo], repoCount: 1, trend: [], deltas: null }),
  getOrgRepoHistories: async () => [],
  listGoals: async () => [],
  listOpsState: async () => null,
  listLocalPairings: async () => [{ fullName: "acme/one", localPath: "C:/code/one" }],
  isDbConfigured: () => true,
}));
vi.mock("@/lib/db/loop-runs", () => ({ getActiveLoopRun: async () => null, listLoopRuns: async () => [], getLoopRunDetail: async () => null }));
vi.mock("@/lib/env", () => ({ selfHosted: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => true }));
vi.mock("@/lib/live-share", () => ({ liveShareEnabled: () => false }));
vi.mock("../LiveWarRoom", () => ({ LiveWarRoom: () => <div data-testid="war-room" /> }));
vi.mock("../cockpit", () => ({ LiveCockpit: () => <div data-testid="cockpit" /> }));
vi.mock("../AutopilotBand", () => ({ AutopilotBand: () => <div data-testid="autopilot-band" /> }));
vi.mock("./ledgerLoad", () => ({ hasStandingRunner: vi.fn(async () => h.runner) }));
vi.mock("./LedgerTab", () => ({ LedgerTab: (p: { slug: string }) => <div data-testid="ledger">{p.slug}</div> }));

const { LiveTab } = await import("../LiveTab");
const { hasStandingRunner } = await import("./ledgerLoad");

const view = async (sp: Record<string, string>) => render(await LiveTab({ slug: "acme", sp: { tab: "live", ...sp } }));

beforeEach(() => {
  vi.clearAllMocks();
  h.runner = false;
});

describe("resolveLiveView (pure)", () => {
  it.each([
    ["wall", false, "wall"],
    ["wall", true, "wall"],
    ["ledger", false, "ledger"],
    ["cockpit", true, "cockpit"],
    ["", true, "ledger"],
    ["", false, "cockpit"],
    ["nonsense", true, "ledger"],
    ["nonsense", false, "cockpit"],
  ] as const)("view=%s, runner=%s → %s", (v, runner, want) => {
    expect(resolveLiveView(v, runner)).toBe(want);
  });

  it("probes for a runner only when the URL leaves the choice open", () => {
    expect(["wall", "ledger", "cockpit", "", "x"].map(needsRunnerProbe)).toEqual([false, false, false, true, true]);
  });
});

describe("LiveTab view routing", () => {
  it("opens the Ledger by default when a standing runner exists", async () => {
    h.runner = true;
    await view({});
    expect(screen.getByTestId("ledger")).toHaveTextContent("acme");
    expect(screen.queryByTestId("cockpit")).not.toBeInTheDocument();
    expect(hasStandingRunner).toHaveBeenCalledWith("acme");
  });

  it("opens the Cockpit by default when there is no runner", async () => {
    await view({});
    expect(screen.getByTestId("cockpit")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger")).not.toBeInTheDocument();
  });

  it("lets an explicit view win over the runner — without probing for one", async () => {
    h.runner = true;
    await view({ view: "cockpit" });
    expect(screen.getByTestId("cockpit")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger")).not.toBeInTheDocument();
    h.runner = false;
    await view({ view: "ledger" });
    expect(screen.getByTestId("ledger")).toBeInTheDocument();
    expect(hasStandingRunner).not.toHaveBeenCalled();
  });

  it("leaves ?view=wall exactly the wall, runner or not", async () => {
    h.runner = true;
    await view({ view: "wall" });
    expect(screen.getByTestId("war-room")).toBeInTheDocument();
    expect(screen.getByTestId("autopilot-band")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cockpit")).not.toBeInTheDocument();
    expect(hasStandingRunner).not.toHaveBeenCalled();
  });
});
