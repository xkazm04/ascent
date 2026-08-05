// @vitest-environment jsdom
//
// First tests for the scan-scope disclosure. The behavior pinned here is the one that was broken:
// `open = userOpened || hasScope` made the toggle INERT once any scope value existed — clicking set
// userOpened=false while hasScope kept `open` true, so the `−` control never collapsed, aria-expanded
// never changed (a screen-reader user is told "expanded", activates, and gets no state change), and
// the collapsed-summary chip was unreachable dead code.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EMPTY_SCOPE, ScanScopeFields, scopeQuery, validateScope } from "./ScanScopeFields";

const toggle = () => screen.getByRole("button", { name: /Branch/i });

describe("ScanScopeFields — the disclosure actually discloses", () => {
  it("starts collapsed with no scope, and opens on click", () => {
    render(<ScanScopeFields value={EMPTY_SCOPE} onChange={vi.fn()} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText(/Branch, tag or commit/i)).toBeTruthy();
  });

  it("auto-reveals when a scope arrives from the parent (a pasted /tree/<branch> link)", () => {
    render(<ScanScopeFields value={{ ref: "develop", subPath: "" }} onChange={vi.fn()} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByLabelText(/Branch, tag or commit/i) as HTMLInputElement).value).toBe("develop");
  });

  it("CAN be collapsed again while a scope value is present", () => {
    // The regression: this click used to be a no-op, because hasScope kept `open` true.
    render(<ScanScopeFields value={{ ref: "develop", subPath: "" }} onChange={vi.fn()} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/Branch, tag or commit/i)).toBeNull();
  });

  it("shows the collapsed summary chip once collapsed — previously unreachable", () => {
    render(<ScanScopeFields value={{ ref: "develop", subPath: "packages/api" }} onChange={vi.fn()} />);
    fireEvent.click(toggle());
    expect(toggle().textContent).toContain("develop");
    expect(toggle().textContent).toContain("packages/api/");
  });

  it("keeps a deliberately-opened panel open when the scope is cleared", () => {
    const { rerender } = render(<ScanScopeFields value={EMPTY_SCOPE} onChange={vi.fn()} />);
    fireEvent.click(toggle());
    rerender(<ScanScopeFields value={EMPTY_SCOPE} onChange={vi.fn()} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("disables both inputs while the form is submitting", () => {
    render(<ScanScopeFields value={{ ref: "develop", subPath: "" }} onChange={vi.fn()} disabled />);
    expect((screen.getByLabelText(/Branch, tag or commit/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Sub-path/i) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("scope validation + query building", () => {
  it("accepts an empty scope and rejects an obviously-bad ref or sub-path", () => {
    expect(validateScope(EMPTY_SCOPE)).toBeNull();
    expect(validateScope({ ref: "release/2.1", subPath: "packages/api" })).toBeNull();
    expect(validateScope({ ref: "bad ref!", subPath: "" })).toMatch(/valid git ref/i);
    expect(validateScope({ ref: "", subPath: "../escape" })).toMatch(/relative folder/i);
  });

  it("omits empty fields so an unscoped scan produces exactly the URL it always did", () => {
    expect(scopeQuery(EMPTY_SCOPE)).toBe("");
    expect(scopeQuery({ ref: "develop", subPath: "" })).toBe("&ref=develop");
    expect(scopeQuery({ ref: "", subPath: "packages/api" })).toBe("&path=packages%2Fapi");
  });
});
