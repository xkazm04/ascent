// @vitest-environment jsdom
//
// The render half of the rollout redesign. The view model pins the STATES (practiceRolloutViz.test);
// this pins that the panel actually paints them, that the hatch's refusal to print a number survives
// into the DOM, and that a library nobody has rolled out anything from gets the argument in its zero
// state rather than a row of confident zeros.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";
import type { PracticeRow, PracticeRollout } from "./practiceRows";

const { PracticeRolloutStrip } = await import("./PracticeRolloutStrip");

function minedRow(over: Partial<OrgPractice> = {}): PracticeRow {
  const p: OrgPractice = {
    id: over.id ?? "ci-gates",
    label: "CI gates on merge",
    dimId: "D3",
    what: "w",
    starter: [],
    total: 10,
    strongCount: 5,
    exemplar: null,
    gapRepos: [],
    gapRepoRefs: [],
    ...over,
  };
  return {
    key: `mined:${p.id}`,
    source: "mined",
    id: p.id,
    label: p.label,
    dimId: p.dimId,
    what: p.what,
    adoptionPct: null,
    adoptionLabel: "",
    reachLabel: null,
    opportunity: 0,
    ...(p.prs ? { rollout: p.prs } : {}),
    mined: p,
  };
}

function authoredRow(adoption: Partial<PlaybookAdoption>): PracticeRow {
  const pb = { id: "pb1", title: "Review rota", dimId: "D6", summary: "s" } as unknown as PlaybookRow;
  return {
    key: "authored:pb1",
    source: "authored",
    id: pb.id,
    label: pb.title,
    dimId: pb.dimId,
    what: "s",
    adoptionPct: null,
    adoptionLabel: "",
    reachLabel: null,
    opportunity: 0,
    authored: { playbook: pb, adoption: { repos: 0, appliedRepos: [], lift: null, measured: 0, ...adoption } },
  };
}

const EMPTY: PracticeRollout = {
  playbooksAdopted: 0,
  adoptingRepos: 0,
  playbookLift: null,
  playbookMeasured: 0,
  prsOpen: 0,
  prsMerged: 0,
  practiceLift: null,
  practiceLiftSources: 0,
};

const cell = (c: HTMLElement, id: string, axis: string) => c.querySelector(`[data-cell="${id}:${axis}"]`);

describe("PracticeRolloutStrip", () => {
  it("renders nothing when the library has no practices at all", () => {
    const { container } = render(<PracticeRolloutStrip rollout={EMPTY} rows={[]} fleetSize={9} />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on the matrix, not on a sentence", () => {
    const { container } = render(
      <PracticeRolloutStrip rollout={EMPTY} rows={[minedRow()]} fleetSize={20} />,
    );
    const svg = container.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    expect(svg!.querySelector("title")!.textContent).toContain("Practice rollout across 20 repositories");
  });

  it("hatches a never-assessed practice and prints NO number in either cell", () => {
    const { container } = render(
      <PracticeRolloutStrip
        rollout={EMPTY}
        rows={[minedRow({ total: 0, strongCount: 0 })]}
        fleetSize={20}
      />,
    );
    for (const axis of ["Assessed", "Adopted"]) {
      const g = cell(container, "mined:ci-gates", axis)!;
      expect(g.getAttribute("data-state")).toBe("not-judged");
      expect(g.querySelector("[data-score]")).toBeNull();
    }
  });

  it("prints the measured share where there IS a denominator", () => {
    const { container } = render(
      <PracticeRolloutStrip rollout={EMPTY} rows={[minedRow({ total: 10, strongCount: 5 })]} fleetSize={20} />,
    );
    expect(cell(container, "mined:ci-gates", "Adopted")!.querySelector("[data-score]")!.textContent).toBe("50");
    expect(cell(container, "mined:ci-gates", "Assessed")!.querySelector("[data-score]")!.textContent).toBe("50");
  });

  it("draws an authored standard as declared-but-never-assessed", () => {
    const { container } = render(
      <PracticeRolloutStrip rollout={EMPTY} rows={[authoredRow({ repos: 5 })]} fleetSize={20} />,
    );
    expect(cell(container, "authored:pb1", "Assessed")!.getAttribute("data-state")).toBe("not-judged");
    expect(cell(container, "authored:pb1", "Adopted")!.getAttribute("data-state")).toBe("declared");
    expect(cell(container, "authored:pb1", "Landed")!.getAttribute("data-state")).toBe("missing");
  });

  it("puts the argument in the zero state when nothing has rolled out", () => {
    render(<PracticeRolloutStrip rollout={EMPTY} rows={[minedRow()]} fleetSize={20} />);
    expect(screen.getByText(/Nothing has rolled out yet/)).toBeTruthy();
    expect(screen.queryByText("Repos adopting")).toBeNull();
  });

  it("swaps the em dash for a not-judged mark on an unmeasured lift", () => {
    const rollout: PracticeRollout = { ...EMPTY, adoptingRepos: 3, playbooksAdopted: 1, prsMerged: 2 };
    render(<PracticeRolloutStrip rollout={rollout} rows={[minedRow()]} fleetSize={20} />);
    expect(screen.getByText("Repos adopting")).toBeTruthy();
    expect(screen.getAllByText("not judged")).toHaveLength(2);
    expect(screen.queryByText("no repo has been scanned on both sides yet")).toBeNull();
  });

  it("keeps a legend row for every state the data actually contains, and no others", () => {
    render(
      <PracticeRolloutStrip
        rollout={EMPTY}
        rows={[minedRow({ total: 0, strongCount: 0 }), authoredRow({ repos: 2 })]}
        fleetSize={20}
      />,
    );
    for (const label of ["Declared, not enforced", "Not judged", "No measurement"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Superseded")).toBeNull();
  });

  it("states unit and window in the scope line, never meaning", () => {
    render(<PracticeRolloutStrip rollout={EMPTY} rows={[minedRow()]} fleetSize={41} />);
    expect(screen.getByText("1 practice · 41 repos")).toBeTruthy();
  });
});
