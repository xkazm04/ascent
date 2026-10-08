// @vitest-environment jsdom
// A failed history read is not "never scanned": an unreachable database renders an honest unavailable
// notice on /trends, and a repo that truly has no scans still gets "No scans recorded yet".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ history: vi.fn() }));

vi.mock("@/components/report/ReportShell", () => ({ ReportShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/signin-gate", () => ({ resolveSignInState: async () => ({ needsSignIn: false, provider: null, expired: false }) }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: async () => null }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getRepositoryHistory: h.history }));
vi.mock("@/lib/db/repo-deployments", () => ({ getRepositoryDeployments: async () => [] }));

import TrendsPage from "@/app/trends/page";

const { DbUnavailableError } = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
const renderPage = async () => render(await TrendsPage({ searchParams: Promise.resolve({ repo: "acme/web" }) }));

beforeEach(() => {
  h.history.mockReset();
});

describe("/trends — a failed history read", () => {
  it("reads strictly and renders the unavailable notice, not 'No scans recorded yet'", async () => {
    h.history.mockRejectedValue(new DbUnavailableError(new Error("down")));
    await renderPage();
    expect(h.history.mock.calls[0]![2]).toMatchObject({ strict: true });
    expect(screen.getByText(/unavailable right now/i)).toBeTruthy();
    expect(screen.queryByText(/no scans recorded yet/i)).toBeNull();
  });

  it("a repo that truly has no scans still says so", async () => {
    h.history.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText(/no scans recorded yet/i)).toBeTruthy();
    expect(screen.queryByText(/unavailable right now/i)).toBeNull();
  });

  it("any other error still propagates", async () => {
    h.history.mockRejectedValue(new Error('relation "Scan" does not exist'));
    await expect(renderPage()).rejects.toThrow(/relation/);
  });
});
