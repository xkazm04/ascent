// @vitest-environment jsdom
//
// Honesty defects on the per-repo passport card:
//   • It sliced the blocker list to 6 and disclosed nothing — six of eleven blockers under a heading
//     that says "Blockers" reads as the whole list.
//   • It never rendered `passport.declined`. The overlay RETIRES an accepted gap from `blockers`, so a
//     repo whose owner knowingly runs without error tracking drew the same card as one that has it.
//   • Production rungs painted present (`checks`, `scanning`) and unassessable (`prod.*-unassessable`
//     on a `none` level) as the same miss as assessed absence. Unassessable is not a 0.
// Rendered with canEdit={false}: the owner controls are client components with their own tests.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PassportCard } from "./PassportCard";
import type { AppPassport } from "@/lib/types";

const blockers = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} blocker ${i + 1}.`);
const show = (over: Partial<AppPassport> = {}) => render(<PassportCard passport={passport(over)} repo="acme/web" />);
const withProd = (pr: Partial<AppPassport["productionReadiness"]>): Partial<AppPassport> =>
  ({ productionReadiness: { ...passport().productionReadiness, ...pr } });

const passport = (over: Partial<AppPassport> = {}): AppPassport =>
  ({
    passport: "app-passport",
    passportVersion: "0.4.0",
    generatedAt: "2026-09-01",
    identity: { name: "web", slug: "web", purpose: "", archetype: "team", visibility: "private", license: null },
    stack: { languages: [{ name: "TypeScript", primary: true }], frameworks: [], persistence: [], integrations: [], hosting: null, monitoring: {} },
    automationReadiness: {
      level: "L2",
      score: 40,
      blockers: blockers(4, "Automation"),
      selfVerify: { build: true, test: false, lint: false, typecheck: false },
      aiInWorkflow: false,
      artifacts: {},
    },
    productionReadiness: {
      band: "beta",
      score: 50,
      ci: { level: "checks", provider: "github-actions", gates: [] },
      tests: { level: "partial", coveragePct: null, frameworks: [], criticalPathCovered: false },
      security: { level: "none", tools: [] },
      observability: { level: "none" },
      delivery: { migrations: "none", iac: false, rollback: false },
      blockers: blockers(5, "Production"),
    },
    links: {},
    evidence: { confidence: 0.8, source: "static-scan", files: [] },
    ...over,
  }) as unknown as AppPassport;

describe("PassportCard", () => {
  it("DISCLOSES the truncation instead of presenting six of nine as the whole list", () => {
    render(<PassportCard passport={passport()} repo="acme/web" />);
    expect(screen.getByText("Automation blocker 1.")).toBeInTheDocument();
    expect(screen.queryByText("Production blocker 4.")).toBeNull(); // beyond the 6-line cap
    expect(screen.getByText(/\+3 more/)).toBeInTheDocument();
  });

  it("says nothing about truncation when the whole list fits", () => {
    const pp = passport({
      productionReadiness: { ...passport().productionReadiness, blockers: [] },
    });
    render(<PassportCard passport={pp} repo="acme/web" />);
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it("renders the gaps the owner ACCEPTED, with the author — they are retired from `blockers`", () => {
    const pp = passport({
      declined: [{ path: "productionReadiness.observability", label: "Observability", reason: "internal cron worker", by: "alice", at: "2026-02-02" }],
    });
    render(<PassportCard passport={pp} repo="acme/web" />);
    const list = screen.getByTestId("passport-card-declined");
    expect(list).toHaveTextContent("Observability");
    expect(list).toHaveTextContent("declined by alice on 2026-02-02");
    expect(list).toHaveTextContent("internal cron worker");
  });

  it("shows a RE-SURFACED decline as needing re-confirmation, matching the fleet list", () => {
    const pp = passport({
      declined: [
        {
          path: "productionReadiness.security",
          label: "Security scanning",
          by: "bob",
          needsReconfirm: true,
          reconfirmReason: "This gap hardened since it was accepted.",
        },
      ],
    });
    render(<PassportCard passport={pp} repo="acme/web" />);
    const list = screen.getByTestId("passport-card-declined");
    expect(list).toHaveTextContent("1 need re-confirmation");
    expect(list).toHaveTextContent("hardened since it was accepted");
    expect(list).toHaveTextContent("open blocker above until it is re-confirmed");
  });

  it("names an unknown author rather than dropping the attribution", () => {
    const pp = passport({ declined: [{ path: "productionReadiness.ci", label: "CI merge gating" }] });
    render(<PassportCard passport={pp} repo="acme/web" />);
    expect(screen.getByTestId("passport-card-declined")).toHaveTextContent("declined by unknown");
  });

  it("marks present CI as present, not as a miss", () => {
    show();
    const ci = screen.getByTestId("passport-rung-ci");
    expect(ci).toHaveAttribute("data-honesty", "present");
    expect(ci).toHaveTextContent(/checks · present/);
  });

  it("marks gated CI as enforced", () => {
    show(withProd({ ci: { level: "gated", provider: "github-actions", gates: ["test"] } }));
    const ci = screen.getByTestId("passport-rung-ci");
    expect(ci).toHaveAttribute("data-honesty", "enforced");
    expect(ci).toHaveTextContent(/gated · enforced/);
  });

  it("marks scanning security as present, not as a miss", () => {
    show(withProd({ security: { level: "scanning", tools: ["codeql"] } }));
    const sec = screen.getByTestId("passport-rung-security");
    expect(sec).toHaveAttribute("data-honesty", "present");
    expect(sec).toHaveTextContent(/scanning · present/);
  });

  it("still paints assessed-absent observability as a miss", () => {
    show();
    const obs = screen.getByTestId("passport-rung-observability");
    expect(obs).toHaveAttribute("data-honesty", "absent");
    expect(obs).toHaveTextContent("none");
  });

  it("does not treat unassessable observability as none or 0", () => {
    show(withProd({
      observability: { level: "none" },
      findings: [{ id: "prod.observability-unassessable", code: "observability-unassessable", text: "Observability could not be assessed.", severity: "info" }],
    }));
    const obs = screen.getByTestId("passport-rung-observability");
    expect(obs).toHaveAttribute("data-honesty", "unassessable");
    expect(obs).toHaveTextContent("unassessable");
    expect(obs).not.toHaveTextContent(/\bnone\b/);
    expect(obs).not.toHaveTextContent(/\b0\b/);
    expect(obs.querySelector("[title]")?.className).toContain("text-slate-500");
    expect(obs.querySelector("[title]")?.className).not.toContain("text-orange-300");
  });

  it("does not treat unassessable CI as a none miss", () => {
    show(withProd({
      ci: { level: "none", provider: null, gates: [] },
      findings: [{ id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed.", severity: "info" }],
    }));
    const ci = screen.getByTestId("passport-rung-ci");
    expect(ci).toHaveAttribute("data-honesty", "unassessable");
    expect(ci).toHaveTextContent("unassessable");
    expect(ci).not.toHaveTextContent(/\bnone\b/);
  });

  it("keeps a seen CI level as present when gates were unassessable", () => {
    show(withProd({
      findings: [{ id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed.", severity: "info" }],
    }));
    expect(screen.getByTestId("passport-rung-ci")).toHaveAttribute("data-honesty", "present");
  });

  it("does not list a coverage-hole finding under Blockers", () => {
    const hole = "Observability could not be assessed.";
    const gap = "Zero observability: no error tracking.";
    show(withProd({
      observability: { level: "none" },
      blockers: [hole, gap],
      findings: [
        { id: "prod.observability-unassessable", code: "observability-unassessable", text: hole, severity: "info" },
        { id: "prod.zero-observability", code: "zero-observability", text: gap, severity: "block" },
      ],
    }));
    expect(screen.queryByText(hole)).toBeNull();
    expect(screen.getByText(gap)).toBeInTheDocument();
    expect(screen.getByTestId("passport-rung-observability")).toHaveAttribute("data-honesty", "unassessable");
  });
});
