// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DimensionResult } from "@/lib/types";
import { RadarChart } from "./RadarChart";

// Rendered through RadarChart on purpose: the defect this pins was the hand-off dropping `engine`
// (RadarChart passed dimensions/highlight/onSelect to the fallback, not the engine), so a mock-scored
// partial report drew solid, graded-looking bars with no demo caveat.
function dim(id: DimensionResult["id"], name: string, score: number): DimensionResult {
  return { id, name, score, weight: 1, signalScore: score, llmScore: score, summary: "", evidence: [], strengths: [], gaps: [] };
}

describe("RadarFallback engine honesty (under-3-dimension form)", () => {
  it("the under-3 fallback keeps the engine: a mock report's bars are hollow and named a demo scan", () => {
    const { container } = render(
      <RadarChart dimensions={[dim("D1", "AI Tooling", 72), dim("D2", "Testing", 41)]} engine="mock" />,
    );
    const hollow = Array.from(container.querySelectorAll<HTMLElement>("div[data-mock]"));
    expect(hollow).toHaveLength(2);
    for (const bar of hollow) {
      expect(bar.style.backgroundColor).toBe("var(--color-surface-strong)");
      expect(bar.style.boxShadow).toMatch(/inset/);
    }
    expect(screen.getByRole("img", { name: /AI Tooling: 72 of 100.*demo scan: deterministic rubric, no model/i })).toBeInTheDocument();
    expect(screen.getByText(/hollow marks are a demo scan/i)).toBeInTheDocument();
  });

  it("the under-3 fallback on a live report stays solid with no demo caveat", () => {
    const { container } = render(
      <RadarChart dimensions={[dim("D1", "AI Tooling", 72), dim("D9", "Security", 88)]} engine="claude-cli" />,
    );
    expect(container.querySelectorAll("div[data-mock]")).toHaveLength(0);
    expect(screen.queryByText(/demo scan/i)).not.toBeInTheDocument();
  });
});
