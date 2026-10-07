// @vitest-environment jsdom
//
// The report permalink's segment error boundary: logs the error, shows the digest reference only when
// there is one, and "Try again" calls reset.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}));

import ReportError from "./error";

afterEach(() => vi.restoreAllMocks());

describe("report permalink error boundary", () => {
  it("renders the failure copy, logs the error, and Try again calls reset", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const error = Object.assign(new Error("kaboom"), { digest: "abc123" });
    render(<ReportError error={error} reset={reset} />);
    expect(screen.getByText("Couldn't load this report")).toBeTruthy();
    expect(screen.getByText("Reference: abc123")).toBeTruthy();
    expect(log).toHaveBeenCalledWith("[report] permalink route error:", error);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Scan another repo" }).getAttribute("href")).toBe("/");
  });

  it("omits the reference line when there is no digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ReportError error={new Error("x")} reset={() => {}} />);
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });
});
