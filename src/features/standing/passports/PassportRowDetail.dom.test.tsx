// @vitest-environment jsdom
//
// Passport 0.4.0 render half: an owner's DECLINED gap must be visible in the expanded row, distinct
// from the open blockers, and a RE-SURFACED decline must read as needing re-confirmation.
//
// Before this, the detail row rendered `blockers` only. The overlay retires an accepted gap FROM that
// list, so declining a gap made it vanish from the product entirely — indistinguishable from a repo
// that never had the gap. These pin the two states the design distinguishes (§2d/§2f).

import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { PassportDetail } from "./PassportRowDetail";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
// The per-blocker decision widget is fetch-driven and out of scope here.
vi.mock("@/components/org/DecisionControl", () => ({ DecisionControl: () => null }));

const { PassportRowDetail } = await import("./PassportRowDetail");

function detail(over: Partial<PassportDetail> = {}): PassportDetail {
  return {
    purpose: "Internal cron worker",
    autoBlockers: [],
    prodBlockers: [],
    selfVerify: { build: true, test: true, lint: true, typecheck: true },
    aiInWorkflow: false,
    ciProvider: "github-actions",
    ciGates: [],
    coveragePct: null,
    criticalPathCovered: false,
    securityTools: [],
    delivery: { migrations: "versioned", iac: false, rollback: false },
    stack: [],
    confidence: 0.8,
    ...over,
  };
}

const render1 = (d: PassportDetail) =>
  render(<PassportRowDetail fullName="acme/web" detail={d} org="acme" decisions={{}} />);

describe("PassportRowDetail — declined gaps (passport 0.4.0)", () => {
  it("shows an accepted gap with its reason, separate from the open blocker list", () => {
    render1(
      detail({
        prodBlockers: ["CI does not gate merges."],
        declined: [
          {
            path: "stack.monitoring.errorTracking",
            label: "Error tracking",
            reason: "Failures page via the platform.",
            blocker: "Zero observability: no error tracking, structured logs, metrics, or tracing.",
            findingId: "prod.zero-observability",
            at: "2025-02-01",
          },
        ],
      }),
    );
    expect(screen.getByText("Accepted by choice")).toBeTruthy();
    expect(screen.getByText("Error tracking")).toBeTruthy();
    expect(screen.getByText(/Failures page via the platform/)).toBeTruthy();
    // The accepted gap's own sentence is present — the decline did not erase it from the product.
    expect(screen.getByText(/Zero observability/)).toBeTruthy();
    // …and it is NOT presented as an open blocker: nothing asks for re-confirmation.
    expect(screen.queryByText("needs re-confirmation")).toBeNull();
  });

  it("marks a re-surfaced decline as needing re-confirmation and says why", () => {
    render1(
      detail({
        prodBlockers: ["No dependency/secret/SAST scanning in CI."],
        declined: [
          {
            path: "productionReadiness.security",
            label: "Security scanning",
            blocker: "No dependency/secret/SAST scanning in CI.",
            findingId: "prod.no-security-scanning",
            at: "2024-01-01",
            needsReconfirm: true,
            reconfirmReason: "This gap hardened since it was accepted (severity block -> critical).",
          },
        ],
      }),
    );
    expect(screen.getByText("needs re-confirmation")).toBeTruthy();
    expect(screen.getByText(/1 need re-confirmation/)).toBeTruthy();
    expect(screen.getByText(/hardened since it was accepted/)).toBeTruthy();
    // The blocker is still open above; the entry tells the reader the duplicate is deliberate.
    expect(screen.getByText(/listed as an open blocker above/)).toBeTruthy();
  });

  it("renders no declined section when the owner has declined nothing", () => {
    render1(detail({ prodBlockers: ["CI does not gate merges."] }));
    expect(screen.queryByText("Accepted by choice")).toBeNull();
  });
});
