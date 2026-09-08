// @vitest-environment jsdom
//
// #16 render half. The one thing this file exists to prevent: a clause nobody judged being drawn as
// a passing control. That happens two ways — a summary-only reporter whose row has no findings, and a
// repo that simply did not report a column another repo did — and both are asserted here.

import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ControlMatrixRowView } from "./controlMatrixView";

const { ControlMatrixPanel } = await import("./ControlMatrixPanel");

// The panel now opens on the kit's `MatrixGrid`, which honours `prefers-reduced-motion`. jsdom ships
// no `matchMedia`; the kit's own dom tests stub it the same way.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

function row(over: Partial<ControlMatrixRowView> = {}): ControlMatrixRowView {
  return {
    repoFullName: "acme/api",
    reportedAt: "2026-06-10T00:00:00.000Z",
    summaryOnly: false,
    specVersion: "0.3.0",
    checks: [
      { check: "control.prepush.lint", family: "control", subject: "lint", level: "pass", since: null, message: "" },
      { check: "guardrail.never-commit", family: "guardrail", subject: null, level: "unchecked", since: null, message: "git unavailable" },
    ],
    ...over,
  };
}

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => body })));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ControlMatrixPanel", () => {
  it("renders a repo's cells and marks a summary-only reporter as such", async () => {
    mockFetch({ org: "acme", rows: [row(), row({ repoFullName: "acme/web", summaryOnly: true, checks: [] })] });
    render(<ControlMatrixPanel org="acme" />);
    await waitFor(() => expect(screen.getAllByText("acme/api").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/summary-only/i).length).toBeGreaterThan(0);
    // The summary-only repo contributes to no "reporting" count.
    expect(screen.getByText("Repos reporting").parentElement!.textContent).toContain("1");
  });

  // The overview grid is the panel's first sight (/org redesign §2.2); the expandable table below is
  // the drill-down. Both must name the repo, so a repo appears more than once by design.
  it("opens on the overview grid, with the table below it", async () => {
    mockFetch({ org: "acme", rows: [row()] });
    render(<ControlMatrixPanel org="acme" />);
    const grid = await screen.findByRole("img", { name: /Doctor checks by repository and check family/i });
    expect(grid.getAttribute("aria-label")).toContain("acme/api — control: measured 100, guardrail: not judged");
    // The invariant the deleted lede used to promise: the hatched cell carries no number.
    expect(grid.getAttribute("aria-label")).not.toMatch(/guardrail: not judged \d/);
    expect(grid.querySelector('[data-cell="acme/api:guardrail"] [data-score]')).toBeNull();
  });

  it("draws an unjudged clause as a dash with a tooltip — never as a pass", async () => {
    mockFetch({ org: "acme", rows: [row()] });
    render(<ControlMatrixPanel org="acme" />);
    await waitFor(() => expect(screen.getAllByText("acme/api").length).toBeGreaterThan(0));
    const dash = screen.getAllByLabelText(/not judged/i).filter((el) => el.textContent === "—");
    expect(dash.length).toBeGreaterThan(0);
  });

  it("a repo that never reported a column another repo did gets the same dash, not a blank", async () => {
    mockFetch({
      org: "acme",
      rows: [
        row({ repoFullName: "acme/api" }),
        row({ repoFullName: "acme/web", checks: [{ check: "control.prepush.lint", family: "control", subject: "lint", level: "pass", since: null, message: "" }] }),
      ],
    });
    render(<ControlMatrixPanel org="acme" />);
    await waitFor(() => expect(screen.getAllByText("acme/web").length).toBeGreaterThan(0));
    expect(screen.getByLabelText(/did not report this clause/i)).toBeTruthy();
    // …and the same absence is a hatch in the overview, not an empty (reassuring) cell.
    const grid = screen.getByRole("img", { name: /Doctor checks by repository/i });
    expect(grid.querySelector('[data-cell="acme/web:guardrail"]')?.getAttribute("data-state")).toBe("not-judged");
  });

  it("says an org has reported nothing rather than drawing an empty (reassuring) grid", async () => {
    mockFetch({ org: "acme", rows: [] });
    render(<ControlMatrixPanel org="acme" />);
    await waitFor(() => expect(screen.getByText(/has reported a doctor run yet/i)).toBeTruthy());
  });

  it("surfaces a failed request as an error, not as a fleet with no controls", async () => {
    mockFetch({ error: "The control matrix requires a database." }, false, 503);
    render(<ControlMatrixPanel org="acme" />);
    await waitFor(() => expect(screen.getByText(/requires a database/i)).toBeTruthy());
    expect(screen.queryByText(/has reported a doctor run yet/i)).toBeNull();
  });
});
