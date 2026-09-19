// @vitest-environment jsdom
//
// roadmap-recommendation-tracking #6: "Applied ✓" in the Roadmap Sandbox simulators must track the
// ITEM the user clicked, not its DIMENSION. Several roadmap items can target the same dimension;
// keying off the dimension override alone lit up every sibling item the moment one was tried — a false
// positive implying unrelated recommendations were applied. This pins per-item tracking + un-apply on
// reset, using the same state handlers RoadmapSandbox wires in.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { DimensionId, LlmRoadmapItem, ScanReport } from "@/lib/types";
import type { cheapestPathToNextLevel } from "@/lib/scoring/engine";
import type { Overrides } from "./RoadmapSandboxParts";

// RoadmapMeta pulls in the scoring engine for its chips; stub it so this targets the simulator wiring.
// RoadmapFirstStep stays real — the Try-it rows must render the same omit-when-blank line as the tracker.
vi.mock("@/components/report/roadmapPieces", async (orig) => ({
  ...(await orig<typeof import("@/components/report/roadmapPieces")>()),
  RoadmapMeta: () => null,
}));

import { RoadmapSimulators } from "./RoadmapSandboxParts";

const ITEMS = [
  { dimension: "D1", title: "Add CI gate" },
  { dimension: "D1", title: "Add coverage gate" }, // SAME dimension as the first
  { dimension: "D2", title: "Improve docs" },
] as unknown as LlmRoadmapItem[];

const report = { roadmap: ITEMS } as unknown as ScanReport;
const emptyPath = { steps: [], target: null } as unknown as ReturnType<typeof cheapestPathToNextLevel>;

/** Harness that owns the exact overrides + appliedItems state RoadmapSandbox owns. */
function Harness() {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [appliedItems, setAppliedItems] = useState<Set<number>>(() => new Set());
  return (
    <div>
      <button onClick={() => { setOverrides({}); setAppliedItems(new Set()); }}>reset-all</button>
      <RoadmapSimulators
        report={report}
        overrides={overrides}
        path={emptyPath}
        appliedItems={appliedItems}
        onTry={(id: DimensionId, i: number) => {
          setOverrides((o) => ({ ...o, [id]: 100 }));
          setAppliedItems((s) => new Set(s).add(i));
        }}
      />
    </div>
  );
}

/** The Try-it/Applied button for the roadmap row carrying `title`. */
function rowButton(title: string): HTMLButtonElement {
  const li = screen.getByText(title).closest("li")!;
  return within(li).getByRole("button") as HTMLButtonElement;
}

describe("RoadmapSimulators — Applied tracks the item, not the dimension (#6)", () => {
  it("marks ONLY the clicked item applied — a sibling on the same dimension stays 'Try it'", () => {
    render(<Harness />);
    // Baseline: all three are "Try it →".
    expect(rowButton("Add CI gate").textContent).toContain("Try it");
    expect(rowButton("Add coverage gate").textContent).toContain("Try it");

    fireEvent.click(rowButton("Add CI gate"));

    expect(rowButton("Add CI gate").textContent).toContain("Applied");
    // The sibling item on the SAME dimension (D1) must NOT flip — the pre-fix false positive.
    expect(rowButton("Add coverage gate").textContent).toContain("Try it");
    // A different-dimension item is likewise untouched.
    expect(rowButton("Improve docs").textContent).toContain("Try it");
    expect(rowButton("Add CI gate")).toHaveAttribute("aria-pressed", "true");
    expect(rowButton("Add coverage gate")).toHaveAttribute("aria-pressed", "false");
  });

  it("un-applies when the dimension is reset away from 100", () => {
    render(<Harness />);
    fireEvent.click(rowButton("Add CI gate"));
    expect(rowButton("Add CI gate").textContent).toContain("Applied");

    fireEvent.click(screen.getByRole("button", { name: "reset-all" }));
    expect(rowButton("Add CI gate").textContent).toContain("Try it");
  });
});

function renderSims(items: LlmRoadmapItem[]) {
  render(
    <RoadmapSimulators
      report={{ roadmap: items } as unknown as ScanReport}
      overrides={{}}
      path={emptyPath}
      appliedItems={new Set()}
      onTry={() => {}}
    />,
  );
}

describe("RoadmapSimulators — firstStep on Try-it rows", () => {
  it("shows the first-step line on the one row that recorded it", () => {
    renderSims([
      { dimension: "D1", title: "Add CI gate", firstStep: "Open a PR adding CODEOWNERS." },
      { dimension: "D2", title: "Improve docs" },
      { dimension: "D3", title: "Blank step", firstStep: "   " },
    ] as unknown as LlmRoadmapItem[]);

    const withStep = screen.getByText("Add CI gate").closest("li")!;
    expect(within(withStep).getByText("First step:")).toBeInTheDocument();
    expect(within(withStep).getByText(/Open a PR adding CODEOWNERS\./)).toBeInTheDocument();
    expect(within(screen.getByText("Improve docs").closest("li")!).queryByText("First step:")).not.toBeInTheDocument();
    expect(within(screen.getByText("Blank step").closest("li")!).queryByText("First step:")).not.toBeInTheDocument();
    expect(screen.getAllByText("First step:")).toHaveLength(1);
  });

  it("renders NOTHING when the scan recorded no first step — no placeholder line", () => {
    renderSims([{ dimension: "D1", title: "Add CI gate" } as unknown as LlmRoadmapItem]);
    expect(screen.queryByText("First step:")).not.toBeInTheDocument();
  });
});
