// @vitest-environment jsdom
//
// P4 PROVENANCE. Criticality, lifecycle and tested-rollback are the three passport fields a scan
// cannot observe: an owner asserts them through the overrides blob and `applyPassportOverrides` folds
// them into the passport at read time. That merge was lossy — `org-rollup` dropped the parsed blob —
// so the card rendered an asserted "GA · mission-critical" in exactly the same voice as an observed
// one, and a reader had no way to tell a claim from a measurement. Declines already carried their
// provenance; these three carried none outside the edit form.
//
// Both states are pinned here, because the acceptance is symmetric: an override says so, and a repo
// with NO override must look exactly as it always did.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AppPassport } from "@/lib/types";
import type { PassportOwnerSet } from "@/lib/db/org-rollup";

// The owner form is client-only (router + fetch) and has its own provenance assertions below.
vi.mock("@/features/standing/passports/PassportOwnerControls", () => ({
  PassportOwnerControls: ({ ownerSet }: { ownerSet?: PassportOwnerSet | null }) => (
    <div data-testid="owner-controls">{JSON.stringify(ownerSet ?? null)}</div>
  ),
}));

const { PassportCard } = await import("./PassportCard");
const { OWNER_SET_LABEL } = await import("./OwnerSetCue");

const passport = (): AppPassport =>
  ({
    identity: { purpose: "Billing", criticality: "mission-critical", lifecycle: "ga" },
    generatedAt: "2026-08-20",
    automationReadiness: {
      level: "L3", score: 60, blockers: [],
      selfVerify: { build: true, test: true, lint: true, typecheck: true },
      aiInWorkflow: false,
    },
    productionReadiness: {
      band: "beta", score: 50, blockers: [],
      ci: { level: "checks", provider: "github-actions", gates: [] },
      tests: { level: "partial", coveragePct: null, criticalPathCovered: false },
      security: { level: "policy", tools: [] },
      observability: { level: "none" },
      delivery: { migrations: "none", iac: false, rollback: true },
    },
    stack: { languages: [], frameworks: [], persistence: [], integrations: [] },
    evidence: { source: "scan", confidence: 0.8 },
  }) as unknown as AppPassport;

const card = (ownerSet?: PassportOwnerSet | null, engine?: string) =>
  render(<PassportCard passport={passport()} repo="acme/web" ownerSet={ownerSet} engine={engine} />);

describe("PassportCard — an owner override says so where the grade shows", () => {
  it("marks criticality and lifecycle when the owner asserted them", () => {
    card({ criticality: true, lifecycle: true });
    // One cue per asserted field, right where the value renders.
    expect(screen.getAllByText(OWNER_SET_LABEL)).toHaveLength(2);
    // The VALUES are untouched — the cue qualifies the claim, it does not replace it.
    expect(screen.getByText("mission-critical")).toBeTruthy();
    expect(screen.getByText("ga")).toBeTruthy();
  });

  it("marks only the field the owner actually set", () => {
    card({ lifecycle: true });
    expect(screen.getAllByText(OWNER_SET_LABEL)).toHaveLength(1);
  });

  it("marks an owner-asserted rollback on the delivery rung — the one that lifts the prod score", () => {
    card({ rollback: true });
    expect(screen.getAllByText(OWNER_SET_LABEL)).toHaveLength(1);
    expect(screen.getByText(/migrations: none · rollback/)).toBeTruthy();
  });

  it("changes NOTHING when the repo has no overrides", () => {
    card(null);
    expect(screen.queryByText(OWNER_SET_LABEL)).toBeNull();
    expect(screen.getByText("mission-critical")).toBeTruthy();
    expect(screen.getByText(/migrations: none · rollback/)).toBeTruthy();
  });

  it("hands the same provenance to the owner form, so the two can never disagree", () => {
    render(<PassportCard passport={passport()} repo="acme/web" canEdit ownerSet={{ rollback: true }} />);
    expect(screen.getByTestId("owner-controls").textContent).toBe('{"rollback":true}');
  });
});

describe("PassportCard — placeholder provenance", () => {
  it("labels a mock-engine passport on its provenance line", () => {
    card(null, "mock");
    expect(screen.getByText("placeholder scan")).toBeTruthy();
  });

  it("says nothing when the engine is live, or unknown to the caller", () => {
    card(null, "claude-cli");
    expect(screen.queryByText("placeholder scan")).toBeNull();
    card(null);
    expect(screen.queryByText("placeholder scan")).toBeNull();
  });
});
