// @vitest-environment jsdom
//
// The default book is the viewer's readable workspace, and it never widens: every workspace org is
// re-gated through canReadOrg exactly as a typed ?orgs= slug is, so an org the header resolver offered
// but the read gate now refuses is neither fetched nor rendered as a chip or a row.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  canReadOrg: vi.fn(async (org: string) => org.length > 0),
  resolveViewerWorkspace: vi.fn(async () => ({ options: ["acme", "beta", "public"], active: "acme" })),
  buildPortfolio: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ canReadOrg: h.canReadOrg }));
vi.mock("@/lib/viewer-workspace", () => ({ resolveViewerWorkspace: h.resolveViewerWorkspace }));
vi.mock("@/lib/org/portfolio", async (orig) => ({
  ...(await orig<typeof import("@/lib/org/portfolio")>()),
  buildPortfolio: h.buildPortfolio,
}));
// The shared site chrome suspends outside the Next runtime; it is not what this page owns.
vi.mock("@/components/Brand", () => ({ SiteHeader: () => <header />, SiteFooter: () => <footer /> }));

import PortfolioPage from "./page";
import { summarizePortfolio, type PortfolioCompany } from "@/lib/org/portfolio";

const company = (org: string, over: Partial<PortfolioCompany> = {}): PortfolioCompany => ({
  org,
  scannedCount: 6,
  realScoredCount: 4,
  mockCount: 2,
  dims: { D1: 60, D3: 20 },
  avgOverall: 55,
  levelId: "L3",
  levelName: "Managed",
  adoption: 50,
  rigor: 50,
  posture: "manual",
  trajectory: null,
  perWeek: null,
  etaLabel: null,
  confidence: null,
  percentile: null,
  ...over,
});

async function renderPage(sp: { orgs?: string }) {
  return render(await PortfolioPage({ searchParams: Promise.resolve(sp) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.canReadOrg.mockImplementation(async (org: string) => org !== "beta");
  h.resolveViewerWorkspace.mockResolvedValue({ options: ["acme", "beta", "public"], active: "acme" });
  h.buildPortfolio.mockImplementation(async (orgs: string[]) => ({
    portfolio: summarizePortfolio(orgs.map((o) => company(o))),
    empty: [],
    unavailable: [],
  }));
});

describe("/portfolio - the default book", () => {
  it("opens on the readable workspace and re-gates every org: an unreadable one is not fetched or shown", async () => {
    const { container } = await renderPage({});
    expect(h.buildPortfolio).toHaveBeenCalledTimes(1);
    expect(h.buildPortfolio).toHaveBeenCalledWith(["acme"]);
    expect(h.canReadOrg).toHaveBeenCalledWith("beta");
    const text = container.textContent ?? "";
    expect(text).toContain("acme");
    expect(text).not.toContain("beta");
    expect(container.querySelector('a[href*="beta"]')).toBeNull();
  });

  it("never adds public to the book implicitly", async () => {
    await renderPage({});
    expect(h.buildPortfolio.mock.calls[0]?.[0]).not.toContain("public");
  });

  it("a typed slug the viewer cannot read is dropped exactly as before (no widening)", async () => {
    const { container } = await renderPage({ orgs: "acme, beta" });
    expect(h.buildPortfolio).toHaveBeenCalledWith(["acme"]);
    expect(container.textContent).toContain("1 organization hidden");
  });

  it("an explicitly emptied book renders the prompt, not the workspace", async () => {
    const { container } = await renderPage({ orgs: "" });
    expect(h.buildPortfolio).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Add organizations to compare");
  });

  it("each book company is an exclude chip; the toggle is a plain link", async () => {
    h.canReadOrg.mockImplementation(async () => true);
    const { container } = await renderPage({});
    const chip = container.querySelector('a[href="/portfolio?orgs=beta"]');
    expect(chip?.getAttribute("data-included")).toBe("true");
    expect(chip?.textContent).toContain("acme");
    expect(container.querySelector(`a[href="/portfolio?orgs=acme"]`)?.textContent).toContain("beta");
  });
});

describe("/portfolio - honest denominators and the matrix", () => {
  it("shows the scored count beside the scanned count and discloses mock exclusions", async () => {
    const { container } = await renderPage({ orgs: "acme" });
    const text = container.textContent ?? "";
    expect(text).toContain("4 of 6");
    expect(text).toContain("2 mock excluded");
  });

  it("names the weakest dimension per company and a void mark for an unmeasured one", async () => {
    const { container } = await renderPage({ orgs: "acme" });
    const weakest = container.querySelector('[data-weakest="true"]');
    expect(weakest?.getAttribute("data-dim")).toBe("D3");
    expect(container.querySelector('[data-dim="D2"]')?.getAttribute("data-measured")).toBe("false");
  });

  it("new copy carries no em dash", async () => {
    const { container } = await renderPage({});
    const ours = [...container.querySelectorAll("[data-portfolio-copy]")].map((n) => n.textContent ?? "");
    expect(ours.length).toBeGreaterThan(0);
    for (const t of ours) expect(t).not.toContain("\u2014");
  });
});
