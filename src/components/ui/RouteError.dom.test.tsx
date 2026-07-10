// @vitest-environment jsdom
//
// app-shell-seo-error-pages #3: "Try again" used to call reset() only, which can't recover a SERVER-thrown
// error (it re-renders the same cached server output, which re-throws). The fix refreshes the route first
// so the server components actually re-run, then resets. This pins that wiring plus the navigation escape.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// next/link needs the App Router context to render; stub it to a plain anchor (matches the repo pattern).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { RouteError } from "./RouteError";

afterEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
});

const baseProps = {
  error: new Error("boom") as Error & { digest?: string },
  title: "Something went wrong",
  description: "desc",
  logLabel: "[test] err",
};

describe("RouteError recovery actions", () => {
  it("Try again refreshes the server tree AND resets the boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<RouteError {...baseProps} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a navigation escape hatch (Back to home) — the recovery reset() alone can't provide", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError {...baseProps} reset={vi.fn()} homeHref="/org/acme" homeLabel="Back to org" />);

    expect(screen.getByRole("link", { name: "Back to org" })).toHaveAttribute("href", "/org/acme");
  });
});
