// @vitest-environment jsdom
//
// #16 render half. The one thing this file exists to prevent: a clause nobody judged being drawn as
// a passing control. That happens two ways — a summary-only reporter whose row has no findings, and a
// repo that simply did not report a column another repo did — and both are asserted here.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ControlMatrixRowView } from "./controlMatrixView";

const { ControlMatrixPanel } = await import("./ControlMatrixPanel");

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
    await waitFor(() => expect(screen.getByText("acme/api")).toBeTruthy());
    expect(screen.getAllByText(/summary-only/i).length).toBeGreaterThan(0);
    // The summary-only repo contributes to no "reporting" count.
    expect(screen.getByText("Repos reporting").parentElement!.textContent).toContain("1");
  });

  it("draws an unjudged clause as a dash with a tooltip — never as a pass", async () => {
    mockFetch({ org: "acme", rows: [row()] });
    render(<ControlMatrixPanel org="acme" />);
    await waitFor(() => expect(screen.getByText("acme/api")).toBeTruthy());
    const dash = screen.getAllByLabelText(/not judged/i);
    expect(dash.length).toBeGreaterThan(0);
    expect(dash[0]!.textContent).toBe("—");
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
    await waitFor(() => expect(screen.getByText("acme/web")).toBeTruthy());
    expect(screen.getByLabelText(/did not report this clause/i)).toBeTruthy();
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
