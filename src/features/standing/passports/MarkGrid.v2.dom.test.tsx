// @vitest-environment jsdom
// CellMark grid: a judged share keeps its number, a void says "not measured", and nothing is painted by score hue.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { MatrixRow } from "@/components/org/viz/matrixShared";
import { buildCapabilityMatrix, type CapabilityMatrixInput } from "./capabilityAgg";
import { CAPABILITY_AXES, capabilityVizRows } from "./capabilityViz";
import { controlVizModel } from "./controls/controlMatrixViz";
import type { ControlMatrixRowView } from "./controls/controlMatrixView";
import { MarkGridV2 } from "./MarkGrid.v2";
import type { ManifestReadout } from "@/lib/standard/readout";

function cell(container: HTMLElement, id: string) {
  const node = container.querySelector(`[data-cell="${id}"]`);
  if (!node) throw new Error(`missing cell ${id}`);
  return node;
}

describe("MarkGridV2", () => {
  const rows: MatrixRow[] = [
    {
      id: "repo",
      label: "acme/api",
      cells: [
        { state: "not-judged", score: 80 },
        { state: "missing" },
        { state: "measured", score: 0 },
        { state: "measured", score: 100 },
        { state: "declared", score: 100 },
      ],
    },
  ];

  it("keeps a real zero and refuses a number on an unjudged cell", () => {
    const { container } = render(
      <MarkGridV2 title="Shares" subject="Repository" axes={["Gap", "Void", "Zero", "Full", "Claim"]} rows={rows} />,
    );
    expect(cell(container, "repo:Gap").getAttribute("data-state")).toBe("unmeasured");
    expect(cell(container, "repo:Gap").textContent).toContain("not measured");
    expect(cell(container, "repo:Gap").textContent).not.toMatch(/\d/);
    expect(cell(container, "repo:Void").textContent).toContain("not measured");
    expect(cell(container, "repo:Zero").getAttribute("data-state")).toBe("partial");
    expect(cell(container, "repo:Zero").textContent).toContain("0");
    expect(cell(container, "repo:Full").getAttribute("data-state")).toBe("met");
    expect(cell(container, "repo:Claim").getAttribute("data-state")).toBe("partial");
    expect(cell(container, "repo:Claim").textContent).toContain("100");
    for (const mark of container.querySelectorAll("[data-kit='cell-mark']")) {
      expect((mark as HTMLElement).getAttribute("style")).toBeNull();
    }
  });

  it("says there is no matrix when the fleet has nothing to draw", () => {
    const { getByRole } = render(<MarkGridV2 title="Doctor checks" axes={[]} rows={[]} />);
    expect(getByRole("img", { name: "Doctor checks: no matrix data" })).toBeTruthy();
  });
});

describe("MarkGridV2 from the passport models", () => {
  it("renders a doctor family that was never judged as not measured", () => {
    const row: ControlMatrixRowView = {
      repoFullName: "acme/api",
      reportedAt: "2026-06-10T00:00:00.000Z",
      summaryOnly: false,
      specVersion: "0.3.0",
      checks: [
        { check: "control.a", family: "control", subject: "a", level: "pass", since: null, message: "" },
        { check: "control.b", family: "control", subject: "b", level: "fail", since: null, message: "" },
        { check: "guardrail.a", family: "guardrail", subject: null, level: "unchecked", since: null, message: "" },
      ],
    };
    const model = controlVizModel([row]);
    const { container } = render(<MarkGridV2 title="Doctor checks" axes={model.axes} rows={model.rows} />);
    expect(cell(container, "acme/api:control").getAttribute("data-state")).toBe("partial");
    expect(cell(container, "acme/api:control").textContent).toContain("50");
    expect(cell(container, "acme/api:guardrail").textContent).toContain("not measured");
    expect(cell(container, "acme/api:guardrail").textContent).not.toMatch(/\d/);
  });

  it("renders an undeclared recommended capability as a claim of 0 and two voids", () => {
    const manifest = {
      status: "ok",
      readAt: "2026-06-10T00:00:00.000Z",
      generatedAt: "2026-06-01",
      schemaVersion: "0.3.0",
      schemaAhead: false,
      capabilities: [{ name: "test", command: "npm test", verified: true, placeholder: false, wiredAt: ["ciHardPass"] }],
      controls: { prePush: [], ciHardPass: ["test"] },
      paths: {},
      agents: [],
      purpose: null,
      boundaries: { neverTouch: [], secretsFrom: null },
      placeholders: [],
      unbacked: [],
      notes: [],
    } as ManifestReadout;
    const repos: CapabilityMatrixInput[] = [{ fullName: "acme/api", name: "api", manifest }];
    const viz = capabilityVizRows(buildCapabilityMatrix(repos));
    const { container } = render(<MarkGridV2 title="Capabilities" axes={CAPABILITY_AXES} rows={viz} />);
    expect(cell(container, "test:Proven").getAttribute("data-state")).toBe("met");
    expect(cell(container, "build:Declared").textContent).toContain("0");
    expect(cell(container, "build:Proven").textContent).toContain("not measured");
    expect(cell(container, "build:Enforced").textContent).not.toMatch(/\d/);
  });
});
