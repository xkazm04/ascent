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
import type { PassportFinding } from "@/lib/types";
import type { PassportDetail } from "./PassportRowDetail";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
// Capture which rows the fleet widget is offered on — evidence-limit findings must not get one.
const seen: string[] = [];
const statuses: string[] = [];
vi.mock("@/components/org/DecisionControl", () => ({
  DecisionControl: ({ itemKey, status }: { itemKey: string; status: string }) => {
    seen.push(itemKey);
    statuses.push(status);
    return null;
  },
}));

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

describe("PassportRowDetail — evidence-limit findings stay informational", () => {
  it("omits DecisionControl on unassessable and enforcement-not-observable rows", () => {
    seen.length = 0;
    const gap: PassportFinding = {
      id: "prod.ci-not-gating",
      code: "ci-not-gating",
      text: "CI does not gate merges.",
      severity: "block",
    };
    const holes: PassportFinding[] = [
      { id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed.", severity: "info" },
      { id: "prod.security-unassessable", code: "security-unassessable", text: "Scanning could not be assessed.", severity: "info" },
      { id: "prod.observability-unassessable", code: "observability-unassessable", text: "Observability could not be assessed.", severity: "info" },
      { id: "prod.tests-unassessable", code: "tests-unassessable", text: "Tests could not be assessed.", severity: "info" },
      { id: "auto.self-verify-unassessable", code: "self-verify-unassessable", text: "Self-verify could not be assessed.", severity: "info" },
      { id: "prod.enforcement-not-observable", code: "enforcement-not-observable", text: "Enforcement (branch protection) not observable.", severity: "info" },
    ];
    render1(
      detail({
        autoBlockers: holes.filter((h) => h.id.startsWith("auto.")).map((h) => h.text),
        autoFindings: holes.filter((h) => h.id.startsWith("auto.")),
        prodBlockers: [gap.text, ...holes.filter((h) => h.id.startsWith("prod.")).map((h) => h.text)],
        prodFindings: [gap, ...holes.filter((h) => h.id.startsWith("prod."))],
      }),
    );
    expect(seen).toEqual(["acme/web::prod.ci-not-gating"]);
    for (const h of holes) expect(screen.getByText(h.text)).toBeTruthy();
  });
});

// Card ai-native-passports#A (challenge-2026-09-23): the drawer reads the ONE judgment model. An owner
// decline the overlay RE-SURFACED (needsReconfirm) keeps its blocker open; a member's OrgDecision under
// the same id key used to win the lookup and bury that re-confirmation behind a greyed "Dismissed" pill.
describe("PassportRowDetail — a re-surfaced decline outranks a member's decision", () => {
  it("renders the open decision control, not a greyed Dismissed pill", () => {
    seen.length = 0;
    statuses.length = 0;
    const ci: PassportFinding = { id: "prod.ci-not-gating", code: "ci-not-gating", text: "CI does not gate merges.", severity: "block" };
    const { container } = render(
      <PassportRowDetail
        fullName="acme/web"
        org="acme"
        decisions={{ "acme/web::prod.ci-not-gating": { status: "dismissed", rationale: "n/a", decidedBy: "bob" } }}
        detail={detail({
          prodBlockers: [ci.text],
          prodFindings: [ci],
          declined: [
            {
              path: "productionReadiness.ci",
              label: "CI merge gating",
              blocker: ci.text,
              findingId: ci.id,
              at: "2025-01-01",
              needsReconfirm: true,
              reconfirmReason: "This gap hardened since it was accepted (severity block -> critical).",
            },
          ],
        })}
      />,
    );
    expect(seen).toEqual(["acme/web::prod.ci-not-gating"]);
    expect(statuses).toEqual(["open"]);
    expect(container.querySelector("li.opacity-60")).toBeNull();
  });
});
