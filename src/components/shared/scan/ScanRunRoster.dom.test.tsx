// @vitest-environment jsdom
//
// ScanRunRoster: the end of a fleet scan names every non-scored repo under the fix it needs, with
// that fix's one action. Props-only; the hook owns the roster.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScanRunRoster } from "./ScanRunRoster";
import { DEGRADED_SCAN_ERROR_TEXT, emptyRoster, foldStreamFrame, type ScanRunRoster as Roster } from "./scanRunRosterModel";
import { orgTabHref } from "@/lib/org/orgTabs";

afterEach(() => cleanup());

function partial(): Roster {
  let r = emptyRoster();
  r = foldStreamFrame(r, "repo", { repo: "a/x", error: "boom", charged: true });
  r = foldStreamFrame(r, "repo", { repo: "a/d", error: DEGRADED_SCAN_ERROR_TEXT, charged: false });
  r = foldStreamFrame(r, "repo", { repo: "a/y", skipped: "no_token" });
  r = foldStreamFrame(r, "repo", { repo: "a/c", skipped: "insufficient_credits" });
  r = foldStreamFrame(r, "repo", { repo: "a/z", level: "L3", overall: 61 });
  return r;
}

describe("ScanRunRoster", () => {
  it("names each failed and skipped repo, and never the scored one", () => {
    const { container } = render(<ScanRunRoster org="acme" roster={partial()} onRetry={() => {}} />);
    for (const repo of ["a/x", "a/d", "a/y", "a/c"]) expect(screen.getByText(repo)).toBeTruthy();
    expect(screen.queryByText("a/z")).toBeNull();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(container.textContent).toMatch(/engine was unavailable/i);
    expect(container.textContent).not.toContain("\u2014");
  });

  it("one click retries the failures, and the button discloses the charged one", () => {
    const onRetry = vi.fn();
    render(<ScanRunRoster org="acme" roster={partial()} onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: /Retry 2 failed/ });
    expect(button.textContent).toContain("1 already charged once; a retry is a new scan");
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sends a token failure to Integrations, not to the credits fix", () => {
    render(<ScanRunRoster org="acme" roster={partial()} onRetry={() => {}} />);
    expect(screen.getByRole("link", { name: /Reconnect on Integrations/ }).getAttribute("href")).toBe(orgTabHref("acme", "integrations"));
    expect(screen.getByRole("link", { name: /credit/i })).toBeTruthy();
  });

  it("renders nothing for a clean run", () => {
    const r = foldStreamFrame(emptyRoster(), "repo", { repo: "a/z", level: "L3", overall: 61 });
    const { container } = render(<ScanRunRoster org="acme" roster={r} onRetry={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("disables the retry while a run is in flight", () => {
    render(<ScanRunRoster org="acme" roster={partial()} onRetry={() => {}} busy />);
    expect(screen.getByRole("button", { name: /Retry/ }).getAttribute("aria-disabled")).toBe("true");
  });
});
