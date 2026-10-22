// @vitest-environment jsdom
//
// The counted in-period strip on Overview: names the carried repos, and hands exactly the rescan set
// to the existing bulk-scan hook once (credits, auth and the queue stay server-side). Card rollups-1.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const run = vi.fn();
const hookArgs: unknown[][] = [];
vi.mock("./useOrgScanButton", () => ({
  useOrgScanButton: (...args: unknown[]) => {
    hookArgs.push(args);
    return { p: { running: false, done: 0, total: 0, current: "", roster: { failed: [], credits: [], noToken: [], inProgress: [] } }, run };
  },
}));
vi.mock("./ScanRunRoster", () => ({ ScanRunRoster: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { PeriodCoverageStrip } from "./PeriodCoverageStrip";
import { PeriodCoverageRescan } from "./PeriodCoverageRescan";
import { periodCoverage, type CoverageRow } from "@/lib/org/periodCoverageModel";

const START = new Date("2026-07-01T00:00:00Z");
const NOW = Date.parse("2026-07-20T00:00:00Z");
const r = (n: string, at: string, o: { queued?: boolean; watched?: boolean } = {}): CoverageRow => ({
  fullName: `a/${n}`,
  name: n,
  watched: o.watched ?? true,
  latest: { scannedAt: at, engine: "anthropic" },
  freshness: { queuedRescore: o.queued ?? false },
});

beforeEach(() => {
  run.mockReset();
  hookArgs.length = 0;
});
afterEach(() => cleanup());

describe("PeriodCoverageRescan", () => {
  it("calls run({ repos }) exactly once; a second click while running is refused", () => {
    run.mockImplementation(() => new Promise(() => {}));
    render(<PeriodCoverageRescan slug="acme" repos={["a/x", "a/y"]} />);
    const btn = screen.getByRole("button", { name: "Rescan 2" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ repos: ["a/x", "a/y"] });
    expect(hookArgs[0]?.[0]).toBe("acme");
  });
});

describe("PeriodCoverageStrip", () => {
  it("names the count, the oldest repo and the rescan split", () => {
    const rows = [
      r("fresh", "2026-07-05T00:00:00Z"),
      r("api", "2026-06-09T00:00:00Z"),
      r("web", "2026-06-20T00:00:00Z", { queued: true }),
      r("old", "2026-06-15T00:00:00Z", { watched: false }),
    ];
    render(<PeriodCoverageStrip slug="acme" coverage={periodCoverage(rows, START, NOW)} />);
    const strip = screen.getByTestId("period-coverage-strip");
    const text = strip.textContent ?? "";
    expect(text).toContain("3 of 4 repos have no scan this period");
    expect(text).toContain("oldest: api, 41 days");
    expect(text).toContain("1 already queued");
    expect(text).toContain("1 not watched");
    expect(screen.getByRole("button", { name: "Rescan 1" })).toBeInTheDocument();
    expect(text).not.toContain("\u2014");
  });

  it("every carried repo queued -> a count, no button", () => {
    const rows = [r("fresh", "2026-07-05T00:00:00Z"), r("a", "2026-06-01T00:00:00Z", { queued: true }), r("b", "2026-06-02T00:00:00Z", { queued: true })];
    render(<PeriodCoverageStrip slug="acme" coverage={periodCoverage(rows, START, NOW)} />);
    expect(screen.getByTestId("period-coverage-strip").textContent).toContain("2 rescans already queued");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for all time or when nothing is carried", () => {
    const { container, rerender } = render(<PeriodCoverageStrip slug="acme" coverage={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PeriodCoverageStrip slug="acme" coverage={periodCoverage([r("fresh", "2026-07-05T00:00:00Z")], START, NOW)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
