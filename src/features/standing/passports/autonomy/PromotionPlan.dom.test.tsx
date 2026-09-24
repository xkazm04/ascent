// @vitest-environment jsdom
//
// The promotion plan above the clearance register (challenge-2026-09-23, ai-native-passports#B). The
// register answers "what is each repo cleared for"; the plan answers "which one fix lifts the most
// repos". Clicking a plan row must narrow the register to exactly the repos that carry the condition,
// and one chip must put the whole register back. Repos are built through the REAL resolver
// (deriveAutonomy over synthetic passports), so the ids the plan groups on are the ones it emits.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AppPassport } from "@/lib/types";
import { deriveAutonomy, type RepoAutonomy } from "./autonomyModel";
import { AutonomyClearance } from "./AutonomyClearance";
import { ClearanceCard } from "./ClearanceCard";

interface Knobs {
  agentInstructions?: boolean;
  selfVerifyTest?: boolean;
  testsLevel?: string;
  ciLevel?: string;
  hooks?: boolean;
  aiInWorkflow?: boolean;
  evals?: string;
  migrations?: string;
  /** The CI rung is HELD: the scan minted prod.ci-unassessable (workflows not read in full). */
  ciHeld?: boolean;
}

function passport(name: string, k: Knobs): AppPassport {
  return {
    passport: "app-passport",
    passportVersion: "0.4.0",
    generatedAt: "2026-09-01",
    identity: { name, slug: name, purpose: `${name} service`, archetype: "team", visibility: "private", license: null },
    stack: { languages: [], frameworks: [], persistence: [], integrations: [], hosting: null, monitoring: {} },
    automationReadiness: {
      level: "L3",
      score: 60,
      artifacts: {
        agentInstructions: k.agentInstructions ? ["CLAUDE.md"] : [],
        contextGraph: "none", memory: "none", manifest: false, evals: k.evals ?? "none", skills: "none",
        sandbox: false, hooks: k.hooks ?? false,
      },
      selfVerify: { build: true, test: k.selfVerifyTest ?? false, lint: false, typecheck: false },
      aiInWorkflow: k.aiInWorkflow ?? false,
      blockers: [],
    },
    productionReadiness: {
      band: "beta",
      score: 55,
      ci: { level: k.ciLevel ?? "none", provider: null, gates: [] },
      tests: { level: k.testsLevel ?? "none", coveragePct: null, frameworks: [], criticalPathCovered: false },
      security: { level: "none", tools: [] },
      observability: { level: "none" },
      delivery: { migrations: k.migrations ?? "none", iac: false, rollback: false },
      blockers: [],
      ...(k.ciHeld ? { findings: [{ id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed.", severity: "info" }] } : {}),
    },
    links: {},
    evidence: { confidence: 0.8, source: "static-scan", files: [] },
  } as unknown as AppPassport;
}

/** T1 held back from T2 only by CI gating (tests substantial, hooks present). */
const CI_ONLY: Knobs = { agentInstructions: true, selfVerifyTest: true, testsLevel: "substantial", ciLevel: "checks", hooks: true };
const T3: Knobs = { ...CI_ONLY, ciLevel: "gated", aiInWorkflow: true, evals: "partial", migrations: "versioned" };

const make = (name: string, k: Knobs): RepoAutonomy =>
  deriveAutonomy({ fullName: `acme/${name}`, name, passport: passport(name, k) });

const FLEET: RepoAutonomy[] = [
  make("alpha", CI_ONLY),
  make("bravo", CI_ONLY),
  make("charlie", CI_ONLY),
  make("delta", { ...CI_ONLY, hooks: false }), // CI gating AND guardrails
  make("echo", {}), // T0
  make("foxtrot", T3), // top clearance
];

/** The register's cards each link their repo name; the plan lists no repo names. */
const registerNames = () =>
  screen
    .getAllByRole("link")
    .map((a) => a.textContent)
    .sort();

describe("PromotionPlan inside AutonomyClearance", () => {
  it("fixture sanity: four T1 repos carry t2.ci-gated, three of them alone", () => {
    const t1 = FLEET.filter((r) => r.tier === 1);
    expect(t1.map((r) => r.name)).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(t1.every((r) => r.blockingIds.includes("t2.ci-gated"))).toBe(true);
  });

  it("clicking the t2.ci-gated row narrows the register to its 4 repos; the ✕ chip restores it", () => {
    const { container } = render(<AutonomyClearance repos={FLEET} />);
    expect(registerNames()).toHaveLength(6);

    const row = container.querySelector<HTMLButtonElement>('[data-condition="t2.ci-gated"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    expect(registerNames()).toEqual(["alpha", "bravo", "charlie", "delta"]);
    const chip = screen.getByText("✕").closest("button");
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);

    expect(registerNames()).toHaveLength(6);
    expect(screen.queryByText("✕")).toBeNull();
  });

  it("the ci-gated row states its sole and incidence counts under the transition's grant", () => {
    const { container } = render(<AutonomyClearance repos={FLEET} />);
    const row = container.querySelector<HTMLElement>('[data-condition="t2.ci-gated"]')!;
    expect(within(row).getByText(/3 alone/)).toBeTruthy();
    expect(within(row).getByText(/4 carry/)).toBeTruthy();
    expect(screen.getAllByText(/Refactors with review/).length).toBeGreaterThan(0);
  });

  it("a held-CI repo is named as not assessable and never counted on the ci-gated row", () => {
    const held = make("golf", { ...CI_ONLY, ciLevel: "build", ciHeld: true });
    expect(held.blockingIds).toEqual(["ci-unassessable"]);
    const { container } = render(<AutonomyClearance repos={[...FLEET, held]} />);
    expect(screen.getByText(/1 not assessable \(CI workflow files were not read in full/)).toBeTruthy();
    const row = container.querySelector<HTMLElement>('[data-condition="t2.ci-gated"]')!;
    expect(within(row).getByText(/4 carry/)).toBeTruthy();
    expect(container.querySelector('[data-condition="ci-unassessable"]')).toBeNull();
    // The clearance card's CI gate prints `unassessable`, never the floor's score.
    const card = render(<ClearanceCard repo={held} />).container;
    expect(held.gates.find((g) => g.id === "ci")?.held).toBe(true);
    expect(card.textContent).toMatch(/unassessable: this scan did not read the workflow files in full/);
  });
});

describe("guard: ClearanceCard is unchanged by the plan", () => {
  it("guard: still prints blocking[0] and '+N further conditions' from the same resolver", () => {
    const delta = FLEET.find((r) => r.name === "delta")!;
    render(<ClearanceCard repo={delta} />);
    expect(delta.blocking.length).toBe(2);
    expect(screen.getByText(delta.blocking[0])).toBeTruthy();
    expect(screen.getByText(/\+ 1 further condition$/)).toBeTruthy();
  });
});
