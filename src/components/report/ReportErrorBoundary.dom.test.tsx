// @vitest-environment jsdom
//
// Pins the reset behavior of the report error boundary. The bug: the boundary was STICKY — an error
// caught while viewing repo A stayed on screen after the URL switched to repo B (same /report route,
// component reused, boundary never remounts) until a full reload. resetKeys fixes that.
//
// Also pins G6-03: when no `onRetry` is supplied (the pinned-permalink mount), the boundary must NOT
// offer a reload-style retry that re-crashes on the same persisted, deterministic data. It must instead
// route to a DIFFERENT code path (a fresh live scan) or away entirely.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportErrorBoundary } from "./ReportErrorBoundary";

// next/link needs the App Router context to render; stub it to a plain anchor (matches repo pattern,
// e.g. RouteError.dom.test.tsx).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

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

describe("ReportErrorBoundary — G6-03 no re-crash loop when onRetry is absent", () => {
  it("with onRetry: still offers a 'Try again' BUTTON that calls onRetry (unchanged live-scan path)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onRetry = vi.fn();
    render(
      <ReportErrorBoundary onRetry={onRetry}>
        <Boom fail />
      </ReportErrorBoundary>,
    );
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("without onRetry: renders NO reload/retry button at all — a click can never re-run the same crash", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    // Prove reload is never invoked, whether or not window.location.reload even exists.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(
      <ReportErrorBoundary repoRef="acme/widgets">
        <Boom fail />
      </ReportErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("without onRetry + a repoRef: offers a 'scan fresh' link to the LIVE scanner (a different code path), not the pinned reader", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ReportErrorBoundary repoRef="acme/widgets@abc123">
        <Boom fail />
      </ReportErrorBoundary>,
    );
    const link = screen.getByRole("link", { name: /scan acme\/widgets@abc123 fresh/i });
    expect(link.getAttribute("href")).toBe(`/report?repo=${encodeURIComponent("acme/widgets@abc123")}&fresh=1`);
  });

  it("without onRetry and without a repoRef: still offers an escape hatch (scan another repo), never a bare dead end", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ReportErrorBoundary>
        <Boom fail />
      </ReportErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: /scan another repo/i })).toBeInTheDocument();
  });
});
