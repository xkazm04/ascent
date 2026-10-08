// @vitest-environment jsdom
// /report/compare under the plan's history window: the read carries `since`, the page names the window,
// and an empty clamped list never claims "No scans recorded yet" when older scans exist.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  comparison: vi.fn(),
  viewer: vi.fn(),
  orgs: new Map<string, { plan: string; kind: string }>(),
}));

vi.mock("@/components/Brand", () => ({ SiteHeader: () => null, SiteFooter: () => null }));
vi.mock("@/lib/signin-gate", () => ({ resolveSignInState: async () => ({ needsSignIn: false, provider: null, expired: false }) }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: async () => "public" }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.viewer }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, dbReadStrict: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async (s: string) => h.orgs.get(s) ?? null }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, getScanComparison: h.comparison }));
vi.mock("@/lib/report/exemplar-load", () => ({ loadSubjectFacets: async () => ({}), listExemplarOptions: async () => [] }));
vi.mock("@/components/report/ScanComparePicker", () => ({ ScanComparePicker: () => null }));
vi.mock("@/components/report/WhatChanged", () => ({ WhatChanged: () => null }));
vi.mock("@/lib/report/compare", () => ({ diffScans: () => ({}) }));

import ComparePage from "@/app/report/compare/page";

const renderPage = async () => render(await ComparePage({ searchParams: Promise.resolve({ repo: "acme/web" }) }));
const scan = (id: string) => ({ id, scannedAt: "2026-10-01T00:00:00.000Z", overallScore: 70 });
const cmp = (ids: string[]) => ({
  repo: { owner: "acme", name: "web", fullName: "acme/web" },
  scans: ids.map(scan),
  before: ids.length > 1 ? scan(ids[1]!) : null,
  after: ids.length ? scan(ids[0]!) : null,
});

beforeEach(() => {
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
  h.comparison.mockReset();
  h.viewer.mockResolvedValue("kaz");
  h.orgs.clear();
  h.orgs.set("kaz", { plan: "free", kind: "personal" });
});
afterEach(() => vi.unstubAllEnvs());

describe("/report/compare — the history window", () => {
  it("passes since to the read and says the window and the plan on the page", async () => {
    h.comparison.mockResolvedValue(cmp(["a", "b"]));
    await renderPage();
    expect(h.comparison.mock.calls[0]![2].since).toBeInstanceOf(Date);
    expect(screen.getByText("Showing the last 30 days: the Free plan's history window.")).toBeTruthy();
  });

  it("empty clamped list with older scans: says so, never 'No scans recorded yet'", async () => {
    h.comparison.mockResolvedValueOnce(cmp([])).mockResolvedValueOnce(cmp(["old"]));
    await renderPage();
    expect(screen.getByText(/older than the last 30 days/i)).toBeTruthy();
    expect(screen.queryByText(/no scans recorded yet/i)).toBeNull();
  });

  it("a signed-out reader is unchanged: no since, no window line", async () => {
    h.viewer.mockResolvedValue(null);
    h.comparison.mockResolvedValue(cmp(["a", "b"]));
    await renderPage();
    expect(h.comparison.mock.calls[0]![2].since ?? null).toBeNull();
    expect(screen.queryByText(/history window/i)).toBeNull();
  });

  it("self-host is unchanged", async () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    h.comparison.mockResolvedValue(cmp(["a", "b"]));
    await renderPage();
    expect(h.comparison.mock.calls[0]![2].since ?? null).toBeNull();
    expect(screen.queryByText(/history window/i)).toBeNull();
  });
});
