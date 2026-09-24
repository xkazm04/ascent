// @vitest-environment jsdom
//
// The kiosk wall's run summary (backlog develop-2026-09-17 row 43). When the org has runs, a read-only
// strip under the standing wall states three counts: runs, verified closes, points in review. The token
// page is readable by anyone holding the link, so the operator's decision is COUNTS ONLY: this suite
// seeds runs and a ledger full of repo names, branch names, errors and titles, then asserts that none
// of them reaches the page's props or its DOM, and that the strip carries no control.

import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const standing = { fullName: "acme/one", name: "one", watched: true, lastScanStatus: "ok", lastScanError: null, latest: { overall: 60, adoption: 55, rigor: 65, level: "L3", posture: "manual", scannedAt: "2026-08-22T10:00:00Z" } };
const LEAKS = ["secret-vault", "billing-core", "ascent/loop-", "Rotate the leaked key", "octo-reviewer", "sonnet"];
const run = (id: string, verifiedCloses: number) => ({
  id, phase: "done", repos: ["acme/secret-vault", "acme/billing-core"], cycle: 1, maxCycles: 3,
  startedAt: "2026-09-20T10:00:00.000Z", endedAt: "2026-09-20T11:00:00.000Z", lift: 3, model: "sonnet",
  effort: null, costMicros: 10, seq: 4, driveId: null, planMode: null, lanes: 2, verifiedCloses, landedAt: [],
  error: "ascent/loop-123-secret-vault: Rotate the leaked key failed (octo-reviewer)",
});
const state = vi.hoisted(() => ({ runs: [] as unknown[], summaryReads: 0, orgs: [] as string[] }));
vi.mock("@/lib/db", () => ({
  getOrgRollup: async () => ({ repos: [standing], repoCount: 1, trend: [], deltas: null }),
  getOrgRepoHistories: async () => [],
  isDbConfigured: () => true,
}));
vi.mock("@/lib/db/org-share", () => ({ isLiveShareRevoked: async () => false }));
vi.mock("@/lib/db/members", () => ({ getMembershipRole: async () => "owner", roleAtLeast: () => true }));
vi.mock("@/lib/db/loop-runs", () => ({
  listLoopRuns: async (org: string) => {
    state.summaryReads += 1;
    state.orgs.push(org);
    return state.runs;
  },
}));
vi.mock("@/lib/db/org-impact", () => ({
  getOrgImpactLedger: async () => ({
    inReviewPoints: 7,
    inReviewLanes: 2,
    rows: [{ repoFullName: "acme/secret-vault", practiceLabel: "Rotate the leaked key", prUrl: "https://x/acme/billing-core/pull/1" }],
  }),
}));
vi.mock("@/features/inflight/live/LiveWarRoom", () => ({
  LiveWarRoom: (p: { slug: string }) => <div data-testid="war-room">{p.slug}</div>,
}));
vi.mock("@/features/inflight/live/theater/TheaterShell", () => ({
  TheaterShell: () => <div data-testid="theater" />,
}));

const { signLiveShareToken } = await import("@/lib/live-share");
const { default: SharedLivePage } = await import("./page");
const page = (token: string) => SharedLivePage({ params: Promise.resolve({ token }) });

beforeEach(() => {
  vi.stubEnv("LIVE_SHARE_SECRET", "test-kiosk-summary-secret");
  vi.stubEnv("AUTH_SECRET", "");
  state.runs = [run("a", 3), run("b", 2)];
  state.summaryReads = 0;
  state.orgs = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("/live/shared/[token] run summary", () => {
  it("renders the three counts beneath the standing wall when runs exist", async () => {
    render(await page(signLiveShareToken("acme")!.token));
    const strip = screen.getByRole("region", { name: "Improvement loop summary" });
    expect(within(strip).getByText("Runs").parentElement).toHaveTextContent("2");
    expect(within(strip).getByText("Verified closes").parentElement).toHaveTextContent("5");
    expect(within(strip).getByText("Points in review").parentElement).toHaveTextContent("+7");
    // Beneath the wall, not instead of it.
    const wall = screen.getByTestId("war-room");
    expect(wall.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The org the TOKEN is bound to, and only that one.
    expect(state.orgs).toEqual(["acme"]);
  });

  it("no repo name, branch, error, title, login or model reaches the page's props or its DOM", async () => {
    const tree: ReactElement = await page(signLiveShareToken("acme")!.token);
    const props = JSON.stringify(tree);
    const { container } = render(tree);
    for (const leak of LEAKS) {
      expect(props).not.toContain(leak);
      expect(container.innerHTML).not.toContain(leak);
    }
  });

  it("carries no control: no button, link or form in the strip", async () => {
    render(await page(signLiveShareToken("acme")!.token));
    const strip = screen.getByRole("region", { name: "Improvement loop summary" });
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    expect(within(strip).queryAllByRole("link")).toHaveLength(0);
    expect(strip.querySelector("form, input, select, textarea")).toBeNull();
  });

  it("guard: an org with no runs gets the wall alone", async () => {
    state.runs = [];
    render(await page(signLiveShareToken("acme")!.token));
    expect(screen.getByTestId("war-room")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Improvement loop summary" })).toBeNull();
  });

  it("guard: an expired link is refused before any run is read", async () => {
    render(await page(signLiveShareToken("acme", { ttlMs: -1_000 })!.token));
    expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
    expect(state.summaryReads).toBe(0);
  });

  it("guard: a theater link renders the theater, with no summary read", async () => {
    render(await page(signLiveShareToken("acme", { view: "theater" })!.token));
    expect(screen.getByTestId("theater")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Improvement loop summary" })).toBeNull();
    expect(state.summaryReads).toBe(0);
  });
});
