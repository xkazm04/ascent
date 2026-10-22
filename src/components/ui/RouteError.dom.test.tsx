// @vitest-environment jsdom
//
// app-shell-seo-error-pages #3: "Try again" used to call reset() only, which can't recover a SERVER-thrown
// error (it re-renders the same cached server output, which re-throws). The fix refreshes the route first
// so the server components actually re-run, then resets. This pins that wiring plus the navigation escape.
//
// Also pins G6-13: the full-screen boundary (root error.tsx) must render brand chrome (a logo linking
// home) instead of a bare card - the segment boundary (org shell etc.) must NOT double it, since its
// persistent layout already renders a real header.
//
// app-shell-1: retries that count (escalate to a report after two), a prefilled issue link that carries
// only the digest + a redacted route (or a copy-details button when no tracker is configured), and one
// Sentry capture per error.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { refresh, captureException, site } = vi.hoisted(() => ({
  refresh: vi.fn(),
  captureException: vi.fn(),
  site: { repo: "https://github.com/acme/fork" as string | null },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("@/lib/site", () => ({
  get SOURCE_REPO_URL() {
    return site.repo;
  },
  get FEEDBACK_URL() {
    return site.repo ? `${site.repo}/issues` : "https://github.com/xkazm04/ascent/issues";
  },
}));
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
  // eslint-disable-next-line @next/next/no-img-element -- a test stub for next/image, not page markup
  default: ({ alt, ...rest }: { alt: string }) => <img alt={alt} {...rest} />,
}));

import { RouteError } from "./RouteError";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  site.repo = "https://github.com/acme/fork";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockClear();
  captureException.mockClear();
});

let n = 0;
function withDigest(digest?: string): Error & { digest?: string } {
  const e = new Error("boom secret-token-abc123") as Error & { digest?: string };
  e.digest = digest ?? `d-${++n}`;
  return e;
}

const baseProps = {
  error: new Error("boom") as Error & { digest?: string },
  title: "Something went wrong",
  description: "desc",
  logLabel: "[test] err",
};

/** Click Try again, then remount the boundary the way a re-throw after reset() does. */
function retryAndRemount(error: Error & { digest?: string }) {
  fireEvent.click(screen.getByRole("button", { name: /^Try again/ }));
  cleanup();
  render(<RouteError {...baseProps} error={error} reset={vi.fn()} />);
}

describe("RouteError recovery actions", () => {
  it("Try again refreshes the server tree AND resets the boundary", () => {
    const reset = vi.fn();
    render(<RouteError {...baseProps} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a navigation escape hatch (Back to home) - the recovery reset() alone can't provide", () => {
    render(<RouteError {...baseProps} reset={vi.fn()} homeHref="/org/acme" homeLabel="Back to org" />);

    expect(screen.getByRole("link", { name: "Back to org" })).toHaveAttribute("href", "/org/acme");
  });
});

describe("RouteError brand chrome (G6-13)", () => {
  it("fullScreen (root boundary): renders a home-linked logo above the card - no longer bare", () => {
    render(<RouteError {...baseProps} reset={vi.fn()} fullScreen />);

    expect(screen.getByText("Ascent")).toBeInTheDocument();
    const homeLinks = screen.getAllByRole("link", { name: /ascent|back to home/i });
    // The logo itself is a link to "/".
    expect(homeLinks.some((a) => a.getAttribute("href") === "/")).toBe(true);
  });

  it("segment boundary (fullScreen=false): renders NO extra header - its persistent layout already has one", () => {
    render(<RouteError {...baseProps} reset={vi.fn()} fullScreen={false} />);

    expect(screen.queryByText("Ascent")).toBeNull();
  });
});

describe("RouteError retries that count (app-shell-1)", () => {
  it("first render: Try again is the only primary action, no report CTA", () => {
    render(<RouteError {...baseProps} error={withDigest()} reset={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /report this/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy details/i })).toBeNull();
  });

  it("after two failed retries the card escalates: report becomes primary, retry shows the count", () => {
    const error = withDigest();
    render(<RouteError {...baseProps} error={error} reset={vi.fn()} />);
    retryAndRemount(error);
    expect(screen.getByRole("button", { name: /Try again.*1/ })).toBeInTheDocument();
    retryAndRemount(error);

    expect(screen.getByText(/still failing after 2 tries/i)).toBeInTheDocument();
    const report = screen.getByRole("link", { name: /report this/i });
    expect(report.getAttribute("href")!.startsWith("https://github.com/acme/fork/issues/new?")).toBe(true);
    expect(report).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(screen.getByRole("button", { name: /Try again.*2/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("the report link strips a share token, query string and fragment from the live path", () => {
    window.history.replaceState({}, "", "/live/shared/tok_123?token=abc&x=1#frag");
    const error = withDigest("dig-share");
    render(<RouteError {...baseProps} error={error} reset={vi.fn()} />);
    retryAndRemount(error);
    retryAndRemount(error);

    const href = screen.getByRole("link", { name: /report this/i }).getAttribute("href")!;
    const decoded = decodeURIComponent(href.replace(/\+/g, " "));
    expect(decoded).toContain("dig-share");
    expect(decoded).toContain("/live/shared/[token]");
    for (const leak of ["tok_123", "token=abc", "x=1", "frag", "secret-token-abc123"]) {
      expect(decoded).not.toContain(leak);
    }
  });

  it("no tracker configured: a Copy details button (not a broken link) copies the redacted details", async () => {
    site.repo = null;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    window.history.replaceState({}, "", "/share/briefing/brf_9?x=1");
    const error = withDigest("dig-copy");
    render(<RouteError {...baseProps} error={error} reset={vi.fn()} />);
    retryAndRemount(error);
    retryAndRemount(error);

    expect(screen.queryByRole("link", { name: /report this/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /copy details/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("dig-copy");
    expect(text).toContain("/share/briefing/[token]");
    expect(text).not.toContain("brf_9");
    expect(text).not.toContain("x=1");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("blocked sessionStorage: Try again still works and the card still renders it", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const reset = vi.fn();
    render(<RouteError {...baseProps} error={withDigest()} reset={reset} />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Try again" }))).not.toThrow();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("RouteError Sentry capture (app-shell-1)", () => {
  it("mounted twice with the same digest -> captureException once, tagged with logLabel and digest", () => {
    const error = withDigest("dig-sentry");
    render(<RouteError {...baseProps} error={error} reset={vi.fn()} />);
    cleanup();
    render(<RouteError {...baseProps} error={error} reset={vi.fn()} />);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { boundary: "[test] err", digest: "dig-sentry" },
    });
  });

  it("a different digest is a different error and is captured too", () => {
    render(<RouteError {...baseProps} error={withDigest("dig-a")} reset={vi.fn()} />);
    cleanup();
    render(<RouteError {...baseProps} error={withDigest("dig-b")} reset={vi.fn()} />);
    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
