// @vitest-environment jsdom
//
// moonshot #35 — the wizard's done-phase install CTA. The property that matters most is the FIRST one:
// the disclosure (what a PR contains, that it is a draft, which two secrets report-back would need and
// what App permission that takes) must be on screen BEFORE any request is issued. A user who learns
// about a credential write by finding the secrets in GitHub afterwards was never asked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FoundationPanel } from "./OnboardingFoundationPanel";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => vi.clearAllMocks());

function mockFetch(response: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, json: async () => response }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const REPOS = ["acme/app", "acme/api"];

describe("disclosure before action", () => {
  it("names both secrets and the App permission with no request issued", () => {
    const fetchFn = mockFetch({});
    render(<FoundationPanel org="acme" repos={REPOS} />);
    expect(screen.getByText(/ASCENT_CONFORMANCE_URL/)).toBeTruthy();
    expect(screen.getByText(/ASCENT_CONFORMANCE_TOKEN/)).toBeTruthy();
    expect(screen.getByText(/Secrets: write/)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("says the PR is a draft nobody merges for you", () => {
    mockFetch({});
    render(<FoundationPanel org="acme" repos={REPOS} />);
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText(/Nothing merges without you/)).toBeTruthy();
  });

  it("renders nothing when no repo scanned successfully", () => {
    const { container } = render(<FoundationPanel org="acme" repos={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("install", () => {
  it("POSTs the scanned repos and reports how many PRs opened", async () => {
    const fetchFn = mockFetch({ results: [{ ok: true }, { ok: true }] });
    const onInstalled = vi.fn();
    render(<FoundationPanel org="acme" repos={REPOS} onInstalled={onInstalled} />);
    fireEvent.click(screen.getByRole("button", { name: "Install the foundation in 2 repos" }));
    await waitFor(() => expect(screen.getByText(/Opened 2 draft PRs/)).toBeTruthy());
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).toEqual({ org: "acme", repos: REPOS });
    expect(onInstalled).toHaveBeenCalledWith(2);
  });

  it("lists each successful PR url as a link", async () => {
    mockFetch({
      results: [
        { ok: true, url: "https://github.com/acme/app/pull/11", number: 11 },
        { ok: true, url: "https://github.com/acme/api/pull/22", number: 22 },
      ],
    });
    render(<FoundationPanel org="acme" repos={REPOS} />);
    fireEvent.click(screen.getByRole("button", { name: "Install the foundation in 2 repos" }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.getByRole("link", { name: "PR #11" }).getAttribute("href")).toBe(
      "https://github.com/acme/app/pull/11",
    );
    expect(screen.getByRole("link", { name: "PR #22" }).getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/22",
    );
  });

  it("links an ok row that only has a url (no number)", async () => {
    mockFetch({ results: [{ ok: true, url: "https://github.com/acme/app/pull/11" }] });
    render(<FoundationPanel org="acme" repos={["acme/app"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByRole("link")).toBeTruthy());
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://github.com/acme/app/pull/11");
    expect(screen.getByRole("link").textContent).toBe("https://github.com/acme/app/pull/11");
  });

  it("does not invent a link for an ok row with no url", async () => {
    mockFetch({ results: [{ ok: true }] });
    render(<FoundationPanel org="acme" repos={["acme/app"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByText(/Opened 1 draft PR/)).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("discloses partial failure rather than reporting a clean success", async () => {
    mockFetch({
      results: [
        { ok: true, url: "https://github.com/acme/app/pull/11", number: 11 },
        { ok: false, error: "No saved scan" },
      ],
    });
    render(<FoundationPanel org="acme" repos={REPOS} />);
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByText(/1 repo couldn't be installed/)).toBeTruthy());
    expect(screen.getByText(/No saved scan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "PR #11" }).getAttribute("href")).toBe(
      "https://github.com/acme/app/pull/11",
    );
  });

  it("an all-failed batch is an ERROR, not '0 PRs opened' dressed as success", async () => {
    const onInstalled = vi.fn();
    mockFetch({ results: [{ ok: false, error: "The installation lacks contents/PR write access." }] });
    render(<FoundationPanel org="acme" repos={["acme/app"]} onInstalled={onInstalled} />);
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/write access/));
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("surfaces the route's 403 verbatim (role is never prefetched)", async () => {
    mockFetch({ error: "This action requires the admin role in this organization." }, false);
    render(<FoundationPanel org="acme" repos={REPOS} />);
    fireEvent.click(screen.getByRole("button", { name: /Install the foundation/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/admin role/));
  });

  it("Skip dismisses the panel without any request", () => {
    const fetchFn = mockFetch({});
    const { container } = render(<FoundationPanel org="acme" repos={REPOS} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(container.firstChild).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
