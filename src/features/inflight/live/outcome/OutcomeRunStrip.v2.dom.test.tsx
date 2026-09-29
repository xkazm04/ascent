// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutcomeRunStrip } from "./OutcomeRunStrip.v2";
import type { OutcomeColumn } from "./outcomeMatrix";

const col = (id: string, over: Partial<OutcomeColumn> = {}): OutcomeColumn => ({
  id,
  startedAt: "2026-09-20T10:00:00.000Z",
  endedAt: null,
  phase: "done",
  live: false,
  lift: null,
  agentConfig: null,
  engine: "claude CLI",
  delivery: null,
  cycle: 1,
  maxCycles: 1,
  repoCount: 1,
  gaps: 0,
  ...over,
});

describe("OutcomeRunStrip (Prism level 1)", () => {
  it("leads with the newest run and keeps each run's own number", () => {
    render(<OutcomeRunStrip columns={[col("a"), col("b"), col("c")]} selectedId={null} nowMs={Date.parse("2026-09-21T10:00:00.000Z")} onOpen={() => {}} />);
    const runs = screen.getAllByRole("button").map((b) => b.textContent);
    expect(runs[0]).toContain("Run 3");
    expect(runs[2]).toContain("Run 1");
  });
  it("prints an em dash, never a zero, for a lift that was not measured", () => {
    render(<OutcomeRunStrip columns={[col("a", { lift: null })]} selectedId={null} onOpen={() => {}} />);
    expect(screen.getByTitle("not measured").textContent).toBe("—");
  });
  it("prints a measured lift and marks a failed run in the danger tone", () => {
    const { container } = render(<OutcomeRunStrip columns={[col("a", { lift: 4, phase: "error" })]} selectedId={null} onOpen={() => {}} />);
    expect(container.textContent).toContain("+4");
    expect(container.querySelector(".text-danger")?.textContent).toBe("error");
  });
  it("opens the run it names, and caps the strip with a pointer to the matrix", () => {
    const onOpen = vi.fn();
    const cols = Array.from({ length: 10 }, (_, i) => col(`r${i}`));
    render(<OutcomeRunStrip columns={cols} selectedId="r9" onOpen={onOpen} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onOpen).toHaveBeenCalledWith("r9");
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByText(/2 earlier runs are in the matrix/)).toBeTruthy();
    expect(screen.getAllByRole("button")[0].getAttribute("aria-pressed")).toBe("true");
  });
});
