// @vitest-environment jsdom
//
// app-shell-seo-error-pages #3: "Try again" used to call reset() only, which can't recover a SERVER-thrown
// error (it re-renders the same cached server output, which re-throws). The fix refreshes the route first
// so the server components actually re-run, then resets. This pins that wiring plus the navigation escape.
//
// Also pins G6-13: the full-screen boundary (root error.tsx) must render brand chrome (a logo linking
// home) instead of a bare card — the segment boundary (org shell etc.) must NOT double it, since its
// persistent layout already renders a real header.

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
// next/image likewise needs no real optimizer for this leaf render.
vi.mock("next/image", () => ({
  default: ({ alt, ...rest }: { alt: string }) => <img alt={alt} {...rest} />,
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

describe("RouteError brand chrome (G6-13)", () => {
  it("fullScreen (root boundary): renders a home-linked logo above the card — no longer bare", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError {...baseProps} reset={vi.fn()} fullScreen />);

    expect(screen.getByText("Ascent")).toBeInTheDocument();
    const homeLinks = screen.getAllByRole("link", { name: /ascent|back to home/i });
    // The logo itself is a link to "/".
    expect(homeLinks.some((a) => a.getAttribute("href") === "/")).toBe(true);
  });

  it("segment boundary (fullScreen=false): renders NO extra header — its persistent layout already has one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteError {...baseProps} reset={vi.fn()} fullScreen={false} />);

    expect(screen.queryByText("Ascent")).toBeNull();
  });
});
