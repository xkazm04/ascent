// The provider matrix is the demoted form of two paragraphs a reader used to diff by hand, so what is
// pinned here is the DIFF: three different marks in the Boundary column, one per provider, and none of
// them interchangeable.
//
// The one that matters most is OpenRouter's. "NOT in-boundary like Bedrock" is the single sentence on
// this tab that should change whether an owner pastes a key at all, and the encoding that carries it
// is a VOID — `isVoid("missing")` is true and `rendersValue("missing")` is false, so the cell can
// never acquire a mark or a number that would let it read like Bedrock's. If a future edit hands that
// cell any other state, this file fails.

import { describe, expect, it } from "vitest";
import { isVoid, rendersValue, STATE_LABEL } from "@/components/org/viz";
import type { OrgLlmConfigPublic } from "@/lib/db";
import {
  PROVIDER_AXES,
  PROVIDER_AXIS_HINT,
  providerBoundaryRows,
  providerBoundaryStates,
  providerScopeLine,
  slotState,
} from "./providerBoundaryViz";

function config(over: Partial<OrgLlmConfigPublic> = {}): OrgLlmConfigPublic {
  return {
    provider: "bedrock",
    enabled: false,
    modelId: "us.anthropic.claude-sonnet-4-6",
    region: "eu-west-1",
    authMode: "static",
    hasCredentials: false,
    lastValidatedAt: null,
    lastValidationError: null,
    createdBy: "owner",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...over,
  };
}

const rows = (over: { config?: OrgLlmConfigPublic | null; planAllowed?: boolean } = {}) =>
  providerBoundaryRows({ config: over.config ?? null, planAllowed: over.planAllowed ?? true });

const at = (id: string, axis: (typeof PROVIDER_AXES)[number]) => {
  const row = rows().find((r) => r.id === id)!;
  return row.cells[PROVIDER_AXES.indexOf(axis)]!;
};

describe("provider boundary — the column that carries the warning", () => {
  it("draws three DIFFERENT kinds of answer, so no two providers read alike", () => {
    expect(at("bedrock", "Boundary").state).toBe("measured");
    expect(at("openrouter", "Boundary").state).toBe("missing");
    expect(at("ascent", "Boundary").state).toBe("not-judged");
  });

  it("makes OpenRouter's boundary an absence you can SEE, not one you are promised", () => {
    const cell = at("openrouter", "Boundary");
    expect(isVoid(cell.state)).toBe(true);
    // A void cannot print a value, so it can never be mistaken for a weak-but-present guarantee.
    expect(rendersValue(cell.state)).toBe(false);
    expect(cell.score).toBeUndefined();
  });

  it("refuses to CLAIM the platform default is in-boundary, because this page cannot see it", () => {
    // A self-hosted deployment may well run an Ollama on the operator's own hardware; an Ascent Cloud
    // one does not. The org-scoped settings page observes neither, and "not judged, never as passing"
    // is the honest mark for that.
    const cell = at("ascent", "Boundary");
    expect(cell.state).toBe("not-judged");
    expect(rendersValue(cell.state)).toBe(false);
    expect(STATE_LABEL[cell.state]).toBe("Not judged");
  });

  it("bills both BYOM providers to the customer and neither to the platform row", () => {
    expect(at("bedrock", "Billing").state).toBe("measured");
    expect(at("openrouter", "Billing").state).toBe("measured");
    expect(isVoid(at("ascent", "Billing").state)).toBe(true);
  });
});

describe("provider boundary — the plan gate", () => {
  it("voids both BYOM rows when the org's plan does not include BYOM, and never the platform row", () => {
    const r = providerBoundaryRows({ config: null, planAllowed: false });
    const plan = (id: string) => r.find((x) => x.id === id)!.cells[PROVIDER_AXES.indexOf("Plan")]!.state;
    expect(plan("bedrock")).toBe("missing");
    expect(plan("openrouter")).toBe("missing");
    expect(plan("ascent")).toBe("measured");
  });
});

describe("provider boundary — the single provider slot", () => {
  it("marks nothing connected as a void on both BYOM rows, with the platform measured", () => {
    expect(slotState(null, "bedrock")).toBe("missing");
    expect(slotState(null, "openrouter")).toBe("missing");
    expect(slotState(null, "ascent")).toBe("measured");
  });

  it("rings the provider a person switched on, and SUPERSEDES the platform default it replaced", () => {
    const c = config({ provider: "openrouter", enabled: true, hasCredentials: true });
    expect(slotState(c, "openrouter")).toBe("decided");
    expect(slotState(c, "ascent")).toBe("superseded");
    // …and the provider that did NOT take the slot stays a void rather than borrowing the other's state.
    expect(slotState(c, "bedrock")).toBe("missing");
  });

  it("separates 'stored but never test-connected' from 'stored and not switched on'", () => {
    const untested = config({ hasCredentials: true, lastValidatedAt: null });
    const validated = config({ hasCredentials: true, lastValidatedAt: "2026-07-01T10:00:00.000Z" });
    // Nobody has judged whether an untested credential works — that is not the same claim as
    // "declared, not enforced", and the two must not share a mark.
    expect(slotState(untested, "bedrock")).toBe("not-judged");
    expect(slotState(validated, "bedrock")).toBe("declared");
  });

  it("treats a saved row with no credential as nothing connected", () => {
    expect(slotState(config({ hasCredentials: false }), "bedrock")).toBe("missing");
  });
});

describe("provider boundary — the kit contract", () => {
  it("keeps every axis label inside MatrixGrid's column width", () => {
    for (const axis of PROVIDER_AXES) expect(axis.length).toBeLessThanOrEqual(8);
  });

  it("keeps every row label inside MatrixGrid's 104-unit gutter", () => {
    for (const r of rows()) expect(r.label.length).toBeLessThanOrEqual(13);
  });

  it("gives every column a one-sentence disclosure — the (D) destination of the demoted ledes", () => {
    for (const axis of PROVIDER_AXES) expect(PROVIDER_AXIS_HINT[axis].length).toBeGreaterThan(60);
    expect(PROVIDER_AXIS_HINT.Boundary).toMatch(/NOT in-boundary/);
    expect(PROVIDER_AXIS_HINT.Boundary).toMatch(/third-party upstream/i);
    expect(PROVIDER_AXIS_HINT.Billing).toMatch(/AWS account/);
    expect(PROVIDER_AXIS_HINT.Billing).toMatch(/OpenRouter account/);
  });

  it("legends only the states actually drawn, never a static six-row key", () => {
    const states = providerBoundaryStates(rows());
    expect(states).not.toContain("decided");
    expect(states).not.toContain("superseded");
    const connected = providerBoundaryStates(
      providerBoundaryRows({ config: config({ enabled: true, hasCredentials: true }), planAllowed: true }),
    );
    expect(connected).toContain("decided");
    expect(connected).toContain("superseded");
  });

  it("says the scope in a handful of characters, not the meaning", () => {
    expect(providerScopeLine(null)).toBe("no provider connected");
    expect(providerScopeLine(config({ enabled: true }))).toBe("bedrock · connected");
    expect(providerScopeLine(null).length).toBeLessThanOrEqual(60);
  });
});
