// @vitest-environment jsdom
//
// The per-row ranking bar. FAILS BEFORE: the component did not exist and the formula was a clause in
// a SectionHeader description, identical for all 40 rows.
//
// What is pinned: the three factors are derived through the SAME exported constants the server scored
// with (so the picture cannot drift from the model), the bar is an accessible `role="img"` whose title
// names all three, zero deliveries is a MEASURED zero rather than a missing measurement, and — the
// rule this component must never break — no score is recomputed or printed here.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RecallContribution, recallFactors } from "./RecallContribution";
import { KIND_HALF_LIFE_DAYS, MAX_DELIVERY_BONUS } from "@/lib/memory/recall";

const fill = (c: HTMLElement, id: string) =>
  Number(c.querySelector(`[data-fill="${id}"]`)?.getAttribute("data-value"));

describe("recallFactors", () => {
  it("draws trust straight from the server's confidence", () => {
    const [trust] = recallFactors({ confidence: 0.6, ageDays: 0, kind: "semantic", accessCount: 0 });
    expect(trust?.value).toBeCloseTo(0.6, 5);
  });

  it("halves freshness at exactly one half-life OF THAT KIND, not a shared constant", () => {
    const episodic = recallFactors({
      confidence: 1,
      ageDays: KIND_HALF_LIFE_DAYS.episodic!,
      kind: "episodic",
      accessCount: 0,
    })[1];
    const procedural = recallFactors({
      confidence: 1,
      ageDays: KIND_HALF_LIFE_DAYS.episodic!,
      kind: "procedural",
      accessCount: 0,
    })[1];
    expect(episodic?.value).toBeCloseTo(0.5, 5);
    // The same age is barely any decay for a year-half-life kind — the per-kind claim, drawn.
    expect(procedural?.value).toBeGreaterThan(0.9);
  });

  it("treats zero deliveries as a counted zero, and says so", () => {
    const delivery = recallFactors({ confidence: 1, ageDays: 0, kind: "semantic", accessCount: 0 })[2];
    expect(delivery?.value).toBe(0);
    expect(delivery?.detail).toContain("never delivered");
  });

  it("saturates delivery at the server's cap rather than growing without limit", () => {
    const delivery = recallFactors({
      confidence: 1,
      ageDays: 0,
      kind: "semantic",
      accessCount: 100_000,
    })[2];
    expect(delivery?.value).toBe(1);
    expect(delivery?.detail).toContain(`×${MAX_DELIVERY_BONUS}`);
  });

  it("never returns a non-finite factor, whatever the row carries", () => {
    const factors = recallFactors({
      confidence: Number.NaN,
      ageDays: Number.POSITIVE_INFINITY,
      kind: "unknown-kind",
      accessCount: -5,
    });
    for (const f of factors) expect(Number.isFinite(f.value)).toBe(true);
  });
});

describe("RecallContribution", () => {
  it("is one accessible image naming all three factors", () => {
    const { getByRole } = render(
      <RecallContribution confidence={0.9} ageDays={30} kind="episodic" accessCount={4} />,
    );
    const label = getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("trust");
    expect(label).toContain("freshness");
    expect(label).toContain("delivery");
  });

  it("paints one fill per factor, at the factor's own value", () => {
    const { container } = render(
      <RecallContribution confidence={1} ageDays={0} kind="semantic" accessCount={0} />,
    );
    expect(fill(container, "trust")).toBeCloseTo(1, 3);
    expect(fill(container, "freshness")).toBeCloseTo(1, 3);
    expect(fill(container, "delivery")).toBeCloseTo(0, 3);
  });

  it("prints no score — the score is the response's, and only the row prints it", () => {
    const { container } = render(
      <RecallContribution confidence={0.5} ageDays={10} kind="semantic" accessCount={2} />,
    );
    expect(container.querySelector("text")).toBeNull();
  });
});
