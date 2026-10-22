// @vitest-environment jsdom
//
// The report permalink boundary used to be a hand-rolled fork whose Try again was `reset()` alone - the
// dead button RouteError was fixed for (reset re-renders the same cached server payload, which throws
// again). It is now a RouteError caller: refresh-then-reset, full-screen chrome, and "Scan another repo".

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a test stub for next/image, not page markup
  default: ({ alt, ...rest }: { alt: string }) => <img alt={alt} {...rest} />,
}));

import ReportError from "./error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockClear();
});

function makeError(): Error & { digest?: string } {
  const e = new Error("boom secret-token-abc123") as Error & { digest?: string };
  e.digest = "REPORT_DIGEST";
  return e;
}

describe("report permalink error boundary", () => {
  it("Try again calls router.refresh() BEFORE reset()", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<ReportError error={makeError()} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
  });

  it("the secondary action is 'Scan another repo' to '/'", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ReportError error={makeError()} reset={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Scan another repo" })).toHaveAttribute("href", "/");
  });

  it("keeps its report-specific copy and the digest, never the raw message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ReportError error={makeError()} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /couldn.t load this report/i })).toBeInTheDocument();
    expect(document.body.textContent).toContain("REPORT_DIGEST");
    expect(document.body.textContent).not.toContain("secret-token-abc123");
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("renders the shared full-screen chrome (home-linked logo)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ReportError error={makeError()} reset={vi.fn()} />);
    expect(screen.getByText("Ascent").closest("a")).toHaveAttribute("href", "/");
  });
});
