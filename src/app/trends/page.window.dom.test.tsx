// @vitest-environment jsdom
// /trends under the plan's history window: the read carries `since`, the page names the window, and an
// empty clamped series never claims "No scans recorded yet" when older scans exist.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  history: vi.fn(),
  viewer: vi.fn(),
  orgs: new Map<string, { plan: string; kind: string }>(),
}));

vi.mock("@/components/report/ReportShell", () => ({ ReportShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/signin-gate", () => ({ resolveSignInState: async () => ({ needsSignIn: false, provider: null, expired: false }) }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: async () => "public" }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.viewer }));
vi.mock("@/lib/db/scans-read", () => ({ getOrgForHistoryWindow: async (s: string) => h.orgs.get(s) ?? null }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, getRepositoryHistory: h.history }));
vi.mock("@/lib/db/repo-deployments", () => ({ getRepositoryDeployments: async () => [] }));
vi.mock("@/components/report/DimensionTrends", () => ({ DimensionTrends: () => null }));
vi.mock("@/app/trends/TrajectoryPanel", () => ({ TrajectoryPanel: () => null }));
vi.mock("@/app/trends/TimelineAnnotations", () => ({ TimelineAnnotations: () => null }));
vi.mock("@/app/trends/ExportCsvButton", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/LevelBadge", () => ({ LevelBadge: () => null }));

import TrendsPage from "@/app/trends/page";

const renderPage = async () => render(await TrendsPage({ searchParams: Promise.resolve({ repo: "acme/web" }) }));
const point = (id: string) => ({
  id, scannedAt: "2026-10-01T00:00:00.000Z", overallScore: 70, level: "L3", levelName: "x",
  headSha: id, confidence: 1, engineProvider: "p", engineModel: "m",
});
const history = (ids: string[]) => ({ repo: { owner: "acme", name: "web", fullName: "acme/web" }, scans: ids.map(point) });

beforeEach(() => {
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
  h.history.mockReset();
  h.viewer.mockResolvedValue("kaz");
  h.orgs.clear();
  h.orgs.set("kaz", { plan: "free", kind: "personal" });
});
afterEach(() => vi.unstubAllEnvs());

describe("/trends — the history window", () => {
  it("passes since to the read and says the window and the plan on the page", async () => {
    h.history.mockResolvedValue(history(["a", "b"]));
    await renderPage();
    expect(h.history.mock.calls[0]![2].since).toBeInstanceOf(Date);
    expect(screen.getByText("Showing the last 30 days: the Free plan's history window.")).toBeTruthy();
  });

  it("empty clamped series with older scans: says so, never 'No scans recorded yet'", async () => {
    h.history.mockResolvedValueOnce(history([])).mockResolvedValueOnce(history(["old"]));
    await renderPage();
    expect(screen.getByText(/older than the last 30 days/i)).toBeTruthy();
    expect(screen.queryByText(/no scans recorded yet/i)).toBeNull();
  });

  it("a genuinely empty repo still says 'No scans recorded yet'", async () => {
    h.history.mockResolvedValue(history([]));
    await renderPage();
    expect(screen.getByText(/no scans recorded yet/i)).toBeTruthy();
  });

  it("a signed-out reader is unchanged: no since, no window line", async () => {
    h.viewer.mockResolvedValue(null);
    h.history.mockResolvedValue(history(["a", "b"]));
    await renderPage();
    expect(h.history.mock.calls[0]![2].since ?? null).toBeNull();
    expect(screen.queryByText(/history window/i)).toBeNull();
  });

  it("self-host is unchanged", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    h.history.mockResolvedValue(history(["a", "b"]));
    await renderPage();
    expect(h.history.mock.calls[0]![2].since ?? null).toBeNull();
    expect(screen.queryByText(/history window/i)).toBeNull();
  });
});
