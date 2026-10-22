// @vitest-environment jsdom
//
// Card landing-1: the register's lens switch. "As scored" is today's board; Solo / Team / Org re-weight
// every live row in the browser with the engine's own overallScoreFor and mark each row's rank move.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PublicScanGallery } from "@/lib/db";
import { SCORING_RUBRIC_VERSION, isDimensionId, levelForScore, overallScoreFor } from "@/lib/maturity/model";
import type { DimensionId, RepoArchetype } from "@/lib/types";
import { IndexGallery } from "./IndexGallery";

const ALL: DimensionId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];
const dimsWith = (high: DimensionId[]) => Object.fromEntries(ALL.map((d) => [d, high.includes(d) ? 100 : 50]));

const row = (fullName: string, archetype: RepoArchetype, dims: Record<string, number>) => {
  const overall = overallScoreFor(
    Object.entries(dims).filter(([id]) => isDimensionId(id)).map(([id, score]) => ({ id: id as DimensionId, score })),
    archetype,
  );
  return {
    fullName,
    owner: fullName.split("/")[0]!,
    name: fullName.split("/")[1]!,
    level: levelForScore(overall).id,
    levelName: levelForScore(overall).name,
    overall,
    adoption: 60,
    rigor: 60,
    dimensions: dims,
    posture: "ai-native",
    primaryLanguage: "TypeScript",
    stars: 1,
    scannedAt: "2026-10-01T00:00:00Z",
    href: `/report/${fullName}`,
    rubricVersion: SCORING_RUBRIC_VERSION,
    currentRubric: true,
    verified: true,
    archetype,
  };
};

const A = row("acme/platform", "org", dimsWith(["D3", "D4", "D8", "D9"]));
const B = row("jo/lib", "solo", dimsWith(["D1", "D2"]));
const C = row("team/app", "team", dimsWith(["D8"]));

const gallery = (rows: unknown[], ranked = true): PublicScanGallery =>
  ({
    recent: rows,
    topAiNative: ranked ? rows : [],
    totalRepos: rows.length,
    dbMode: "postgres",
  }) as unknown as PublicScanGallery;

const boardNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("section#gallery a[href^='/report/']")).map(
    (a) => a.querySelector("[title]")?.getAttribute("title"),
  );

describe("IndexGallery - the lens switch", () => {
  // Org first as scored: the org repo's stored score is the higher one under its own lens.
  const asScored = [A, C, B].sort((x, y) => y.overall - x.overall);

  it("defaults to As scored, discloses the lens count, and renders the stored order", () => {
    const { container } = render(<IndexGallery gallery={gallery(asScored)} />);
    expect(screen.getByRole("button", { name: /As scored/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/weighted under 3 lenses/i)).toBeInTheDocument();
    expect(boardNames(container)).toEqual(asScored.map((r) => r.fullName));
  });

  it("clicking Solo presses it, re-orders the rows, marks moves, and explains the re-weighting", () => {
    const { container } = render(<IndexGallery gallery={gallery(asScored)} />);
    fireEvent.click(screen.getByRole("button", { name: "Solo" }));
    expect(screen.getByRole("button", { name: "Solo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /As scored/i })).toHaveAttribute("aria-pressed", "false");
    const names = boardNames(container);
    expect(names[0]).toBe("jo/lib");
    expect(names).not.toEqual(asScored.map((r) => r.fullName));
    const moved = asScored.filter((r, i) => names.indexOf(r.fullName) !== i);
    expect(moved.length).toBeGreaterThan(0);
    for (const r of moved) {
      const link = container.querySelector(`a[href='/report/${r.fullName}']`)!;
      expect(link.querySelector("[data-move]")).not.toBeNull();
    }
    const note = screen.getByText(/re-weighted in the browser/i).closest("p")!;
    expect(note.textContent).toMatch(/engine's .*lens weights/i);
    expect(note.textContent).toMatch(/each report keeps the score it was scored under/i);
    expect(note.textContent).not.toContain("—");
    for (const r of asScored) {
      expect(container.querySelector(`a[href='/report/${r.fullName}']`)).not.toBeNull();
    }
  });

  it("prints the engine's own solo score in each row's average cell", () => {
    const { container } = render(<IndexGallery gallery={gallery(asScored)} />);
    fireEvent.click(screen.getByRole("button", { name: "Solo" }));
    for (const r of asScored) {
      const expected = overallScoreFor(
        Object.entries(r.dimensions).map(([id, score]) => ({ id: id as DimensionId, score })),
        "solo",
      );
      const link = container.querySelector(`a[href='/report/${r.fullName}']`)!;
      expect(link.lastElementChild?.textContent).toBe(String(expected));
    }
  });

  it("counts a row it cannot reproduce instead of re-ranking it, and back to As scored shows it again", () => {
    const ghost = { ...row("ghost/repo", "org", {}), dimensions: {}, overall: 99 };
    const { container } = render(<IndexGallery gallery={gallery([ghost, ...asScored])} />);
    fireEvent.click(screen.getByRole("button", { name: "Org" }));
    expect(boardNames(container)).not.toContain("ghost/repo");
    const withheld = screen.getByText(/1 row .*stays? on the As scored board/i);
    expect(withheld.textContent).not.toContain("—");
    fireEvent.click(screen.getByRole("button", { name: /As scored/i }));
    expect(boardNames(container)[0]).toBe("ghost/repo");
  });

  it("offers no lens on a recency-fallback board", () => {
    render(<IndexGallery gallery={gallery(asScored, false)} />);
    expect(screen.queryByRole("button", { name: "Solo" })).toBeNull();
    expect(screen.queryByText(/weighted under/i)).toBeNull();
  });
});
