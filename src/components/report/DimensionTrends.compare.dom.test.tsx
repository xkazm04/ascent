// @vitest-environment jsdom
// Pins DimensionTrends' compare mode (trends-1): "Compare two scans" turns the overall chart into a
// two-point picker, two picks render one bar linking the pair diff, and narrowing the range so a
// picked point leaves the slice clears that pick.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RepositoryHistory } from "@/lib/db/scans";
import { DimensionTrends } from "./DimensionTrends";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 640, height: 220, right: 640, bottom: 220, toJSON: () => ({}),
  } as DOMRect);
  // Keep the per-dimension lazy load inert: this test is about the overall chart.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

const DAY = 86_400_000;
function scan(id: string, daysAgo: number, score: number) {
  return {
    id,
    headSha: null,
    overallScore: score,
    level: "L3",
    levelName: "Managed",
    confidence: 0.9,
    engineProvider: "claude-cli",
    engineModel: "m",
    scannedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    dimensions: [],
  };
}

// Newest-first, like every history reader: s3 is recent, s1 is 200 days old.
const HISTORY = {
  repo: { owner: "acme", name: "app", fullName: "acme/app" },
  scans: [scan("s3", 1, 70), scan("s2", 3, 66), scan("s1", 200, 60)],
} as unknown as RepositoryHistory;

const chart = () => document.querySelector('svg[role="img"]')!;
function clickAt(clientX: number) {
  fireEvent.pointerMove(chart(), { clientX, clientY: 100 });
  fireEvent.click(chart(), { clientX, clientY: 100 });
}

describe("DimensionTrends compare mode", () => {
  it("two picks render a Compare bar linking the pair diff, older scan as the baseline", () => {
    render(<DimensionTrends history={HISTORY} />);
    fireEvent.click(screen.getByRole("button", { name: /compare two scans/i }));
    clickAt(640); // newest (s3) first
    clickAt(0); // then the oldest (s1)
    const link = screen.getByRole("link", { name: /^compare .+ → .+/i });
    expect(link.getAttribute("href")).toBe("/report/compare?repo=acme%2Fapp&a=s3&b=s1");
    expect(link.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("narrowing the range so a picked point leaves the slice clears that pick", () => {
    render(<DimensionTrends history={HISTORY} />);
    fireEvent.click(screen.getByRole("button", { name: /compare two scans/i }));
    clickAt(640);
    clickAt(0);
    expect(screen.getByRole("link", { name: /^compare .+ → .+/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(screen.queryByRole("link", { name: /^compare .+ → .+/i })).not.toBeInTheDocument();
  });
});
