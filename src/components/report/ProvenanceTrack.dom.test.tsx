// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { DimensionResult, ScoreIntegrity } from "@/lib/types";
import { ProvenanceTrack } from "./ProvenanceTrack";

function dim(id: DimensionResult["id"], signalScore: number, llmScore: number, score: number): DimensionResult {
  return { id, name: id, weight: 0.1, score, signalScore, llmScore, summary: "", evidence: [], strengths: [], gaps: [] };
}

const INTEGRITY: ScoreIntegrity = { d9Unmeasurable: false, widenedDims: ["D2", "D6"], effectiveBlend: 1 };

/** Every band rect the track drew, as {x, width} numbers — the geometry the live UAT capture measured. */
function rects(container: HTMLElement): { x: number; width: number }[] {
  return Array.from(container.querySelectorAll("rect")).map((r) => ({
    x: Number(r.getAttribute("x")),
    width: Number(r.getAttribute("width")),
  }));
}

describe("ProvenanceTrack — the band is per-dimension", () => {
  it("draws a WIDER band on a widened dimension than on an unflagged one", () => {
    // The live defect: every dimension's rect measured the same 28.32px while the report header's
    // integrity chip said D2/D6 were DOUBLED. The chip and the picture must now agree.
    const widened = render(<ProvenanceTrack d={dim("D2", 50, 62, 56)} integrity={INTEGRITY} />);
    const plain = render(<ProvenanceTrack d={dim("D3", 50, 62, 56)} integrity={INTEGRITY} />);
    const wideClamp = rects(widened.container)[0]!;
    const plainClamp = rects(plain.container)[0]!;
    expect(wideClamp.width).toBeGreaterThan(plainClamp.width);
    expect(wideClamp.width).toBeCloseTo(plainClamp.width * 2, 5);
  });

  it("says DOUBLED in the title of a widened dimension and names the real ±band", () => {
    const { container } = render(<ProvenanceTrack d={dim("D2", 50, 62, 56)} integrity={INTEGRITY} />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent ?? "");
    expect(titles.some((t) => /DOUBLED to ±12/.test(t))).toBe(true);
    expect(titles.some((t) => /±6/.test(t) && !/±12/.test(t))).toBe(false);
  });

  it("shows the blend weight as a narrower reach inside the clamp", () => {
    const { container } = render(
      <ProvenanceTrack d={dim("D3", 50, 62, 53)} integrity={{ ...INTEGRITY, effectiveBlend: 0.5 }} />,
    );
    const [clamp, reach] = rects(container);
    expect(reach!.width).toBeLessThan(clamp!.width);
    expect(container.textContent).toMatch(/weighted 50%/);
  });
});

describe("ProvenanceTrack — a mechanism that does not exist is not drawn", () => {
  it("draws NO band and NO LLM tick on a cited-claim dimension, and says why", () => {
    // D1/D4 are scored signal + verified citations. The model's `score` field is recorded and ignored,
    // so a guardband ribbon and an "LLM judgment" tick there drew a lever the reader does not have.
    const { container } = render(<ProvenanceTrack d={dim("D1", 0, 3, 0)} integrity={INTEGRITY} />);
    expect(container.querySelectorAll("rect")).toHaveLength(0);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent ?? "");
    expect(titles.some((t) => /LLM judgment/.test(t))).toBe(false);
    expect(titles.some((t) => /Guardband/.test(t))).toBe(false);
    expect(container.textContent).toMatch(/Cited-claim scored/);
    // The a11y label must carry the same mechanism the picture does.
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toMatch(/No LLM judgment band/);
  });

  it("credits verified citations by their points on a claim-scored dimension that moved", () => {
    const { container } = render(<ProvenanceTrack d={dim("D4", 40, 91, 47)} integrity={INTEGRITY} />);
    expect(container.textContent).toMatch(/Verified citations awarded \+7 points/);
    // 91 is the model's ignored score — it must not be plotted as if it pulled the number.
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("draws NO band and NO LLM tick on the deterministic security battery", () => {
    const { container } = render(<ProvenanceTrack d={dim("D9", 30, 70, 30)} integrity={INTEGRITY} />);
    expect(container.querySelectorAll("rect")).toHaveLength(0);
    expect(container.textContent).toMatch(/Signal-only/);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toMatch(/does not move this number/);
  });

  it("still draws the band and the model tick on a genuinely blended dimension", () => {
    const { container } = render(<ProvenanceTrack d={dim("D3", 50, 62, 56)} integrity={INTEGRITY} />);
    expect(container.querySelectorAll("rect")).toHaveLength(2);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });
});
