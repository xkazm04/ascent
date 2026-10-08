// @vitest-environment jsdom
// A failed comparison read is not "never scanned": an unreachable database renders an honest
// unavailable notice on /report/compare, and a repo that truly has no scans still gets "No scans
// recorded yet".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ comparison: vi.fn() }));

vi.mock("@/components/Brand", () => ({ SiteHeader: () => null, SiteFooter: () => null }));
vi.mock("@/lib/signin-gate", () => ({ resolveSignInState: async () => ({ needsSignIn: false, provider: null, expired: false }) }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: async () => null }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getScanComparison: h.comparison }));
vi.mock("@/lib/report/exemplar-load", () => ({
  loadSubjectFacets: async () => ({}),
  listExemplarOptions: async () => [],
}));
vi.mock("@/components/report/ScanComparePicker", () => ({ ScanComparePicker: () => null }));

import ComparePage from "@/app/report/compare/page";

const { DbUnavailableError } = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
const renderPage = async () => render(await ComparePage({ searchParams: Promise.resolve({ repo: "acme/web" }) }));

beforeEach(() => {
  h.comparison.mockReset();
});

describe("/report/compare — a failed comparison read", () => {
  it("reads strictly and renders the unavailable notice, not 'No scans recorded yet'", async () => {
    h.comparison.mockRejectedValue(new DbUnavailableError(new Error("down")));
    await renderPage();
    expect(h.comparison.mock.calls[0]![2]).toMatchObject({ strict: true });
    expect(screen.getByText(/unavailable right now/i)).toBeTruthy();
    expect(screen.queryByText(/no scans recorded yet/i)).toBeNull();
  });

  it("a repo that truly has no scans still says so", async () => {
    h.comparison.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByText(/no scans recorded yet/i)).toBeTruthy();
    expect(screen.queryByText(/unavailable right now/i)).toBeNull();
  });
});
