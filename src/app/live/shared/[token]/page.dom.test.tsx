// @vitest-environment jsdom
//
// The kiosk page's two variants with REAL signed tokens: every link minted without a view — which is
// every link minted before the theater existed — still renders the wall, read-only; a `view: "theater"`
// link renders the theater shell fed by its own token. The refusals keep their exact words.

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = { fullName: "acme/one", name: "one", watched: true, lastScanStatus: "ok", lastScanError: null, latest: { overall: 60, adoption: 55, rigor: 65, level: "L3", posture: "manual", scannedAt: "2026-08-22T10:00:00Z" } };
const state = vi.hoisted(() => ({ revoked: false, db: true }));
vi.mock("@/lib/db", () => ({
  getOrgRollup: async () => ({ repos: [repo], repoCount: 1, trend: [], deltas: null }),
  getOrgRepoHistories: async () => [],
  isDbConfigured: () => state.db,
}));
vi.mock("@/lib/db/org-share", () => ({ isLiveShareRevoked: async () => state.revoked }));
vi.mock("@/lib/db/members", () => ({ getMembershipRole: async () => "owner", roleAtLeast: () => true }));
vi.mock("@/features/inflight/live/LiveWarRoom", () => ({
  LiveWarRoom: (p: { readOnly?: boolean; slug: string }) => <div data-testid="war-room">{`${p.slug}:${p.readOnly ? "read-only" : "live"}`}</div>,
}));
vi.mock("@/features/inflight/live/theater/TheaterShell", () => ({
  TheaterShell: (p: { source: { kind: string; slug: string; token?: string } }) => (
    <div data-testid="theater">{`${p.source.kind}:${p.source.slug}:${p.source.token}`}</div>
  ),
}));

const { signLiveShareToken } = await import("@/lib/live-share");
const { default: SharedLivePage } = await import("./page");
const open = async (token: string) => render(await SharedLivePage({ params: Promise.resolve({ token }) }));

beforeEach(() => {
  vi.stubEnv("LIVE_SHARE_SECRET", "test-kiosk-page-secret");
  vi.stubEnv("AUTH_SECRET", "");
  state.revoked = false;
  state.db = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("/live/shared/[token]", () => {
  it("a link minted without a view (every pre-theater link) renders the wall, read-only", async () => {
    await open(signLiveShareToken("acme")!.token);
    expect(screen.getByTestId("war-room")).toHaveTextContent("acme:read-only");
    expect(screen.queryByTestId("theater")).toBeNull();
  });

  it("a theater link renders the theater shell, fed by the same token", async () => {
    const { token } = signLiveShareToken("acme", { view: "theater" })!;
    await open(token);
    expect(screen.getByTestId("theater")).toHaveTextContent(`kiosk:acme:${token}`);
    expect(screen.queryByTestId("war-room")).toBeNull();
  });

  it("an invalid, a no-db and a revoked link keep their exact notices", async () => {
    const a = await open("nope");
    expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
    a.unmount();
    state.db = false;
    const b = await open(signLiveShareToken("acme", { view: "theater" })!.token);
    expect(screen.getByText("No data")).toBeInTheDocument();
    b.unmount();
    state.db = true;
    state.revoked = true;
    await open(signLiveShareToken("acme", { view: "theater" })!.token);
    expect(screen.getByText("Link revoked")).toBeInTheDocument();
    expect(screen.queryByTestId("theater")).toBeNull();
  });
});
