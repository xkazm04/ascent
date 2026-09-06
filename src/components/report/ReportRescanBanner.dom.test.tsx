// @vitest-environment jsdom
//
// The re-scan banner's FAILURE branches. A re-test fails for the same reasons a first scan does, but
// the banner used to keep only the message: a 401, a quota block or a 402 all rendered "Retry" — a
// button that re-trips the same gate — with no sign-in / plans / credits path. These pin that each
// class now offers the action that can clear it, that Retry is offered ONLY for the transient class,
// and that Dismiss (the way back to the untouched report underneath) is always there.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RescanBanner } from "./ReportRescanBanner";
import type { ScanErrorClass } from "./useReportScan";

const renderFailed = (errorClass: ScanErrorClass, error = "Something went wrong.") =>
  render(
    <RescanBanner
      repo="acme/app"
      progress={{ message: "", pct: 0 }}
      error={error}
      errorClass={errorClass}
      signInNext="/report?repo=acme%2Fapp"
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );

const retry = () => screen.queryByRole("button", { name: /^retry$/i });

describe("RescanBanner — a failed re-test keeps the error's classification", () => {
  it("transient: Retry is the action (nothing else can be offered)", () => {
    renderFailed({}, "Network error while scanning.");
    expect(retry()).not.toBeNull();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
    expect(document.body.textContent).toContain("Your existing report is unchanged.");
  });

  it("auth wall: offers sign-in (carrying the return path) and no Retry", () => {
    renderFailed({ authRequired: true }, "Sign in to run a scan.");
    expect(screen.getByRole("button", { name: /sign in to re-scan/i })).toBeInTheDocument();
    expect(retry()).toBeNull();
  });

  it("monthly quota: names the reset date and offers plans, not Retry", () => {
    renderFailed({ blocked: { scope: "anon", resetAt: Date.UTC(2026, 8, 30) } }, "Out of free scans.");
    expect(document.body.textContent).toMatch(/the limit resets on/i);
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
    expect(retry()).toBeNull();
  });

  it("out of credits: names the balance and leads to the org's credits control, not Retry", () => {
    renderFailed({ credits: { balance: 0 } }, "Out of private-scan credits.");
    expect(document.body.textContent).toContain("0 scan credits left.");
    expect(screen.getByRole("link", { name: /add credits/i })).toHaveAttribute("href", "/org/acme");
    expect(retry()).toBeNull();
  });

  it("unreadable repo: offers the connect path, not Retry", () => {
    renderFailed({ notFound: true }, "Repository not found or is private.");
    expect(screen.getByRole("link", { name: /connect github/i })).toHaveAttribute("href", "/onboarding");
    expect(retry()).toBeNull();
  });

  it("still shows the live progress row while the re-scan is running (error === null)", () => {
    render(
      <RescanBanner
        repo="acme/app"
        progress={{ message: "Working…", pct: 20, stage: "tree" }}
        error={null}
        errorClass={{}}
        signInNext="/report?repo=acme%2Fapp"
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Re-scanning");
  });
});
