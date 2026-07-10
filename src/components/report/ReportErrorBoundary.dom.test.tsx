// @vitest-environment jsdom
//
// Pins the reset behavior of the report error boundary. The bug: the boundary was STICKY — an error
// caught while viewing repo A stayed on screen after the URL switched to repo B (same /report route,
// component reused, boundary never remounts) until a full reload. resetKeys fixes that.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportErrorBoundary } from "./ReportErrorBoundary";

afterEach(() => vi.restoreAllMocks());

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error("kaboom");
  return <div>report body</div>;
}

describe("ReportErrorBoundary reset-on-key", () => {
  it("renders the recovery card when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ReportErrorBoundary resetKeys={["acme/a"]}>
        <Boom fail />
      </ReportErrorBoundary>,
    );
    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();
  });

  it("CLEARS the caught error when resetKeys change (repo A -> repo B), showing the new content", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ReportErrorBoundary resetKeys={["acme/a"]}>
        <Boom fail />
      </ReportErrorBoundary>,
    );
    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();

    // Navigate to a different repo: the key changes and the new repo renders fine.
    rerender(
      <ReportErrorBoundary resetKeys={["acme/b"]}>
        <Boom fail={false} />
      </ReportErrorBoundary>,
    );
    expect(screen.queryByText(/couldn't be displayed/i)).toBeNull();
    expect(screen.getByText("report body")).toBeInTheDocument();
  });

  it("does NOT auto-reset across a re-render with the SAME key (only the repo switch / Try again clears it)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ReportErrorBoundary resetKeys={["acme/a"]}>
        <Boom fail />
      </ReportErrorBoundary>,
    );
    rerender(
      <ReportErrorBoundary resetKeys={["acme/a"]}>
        <Boom fail={false} />
      </ReportErrorBoundary>,
    );
    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();
  });
});
