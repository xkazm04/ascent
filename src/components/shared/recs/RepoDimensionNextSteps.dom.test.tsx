// @vitest-environment jsdom
//
// The heatmap drill-in's next steps as a decision point: closed work is never presented as open, a
// verdict goes through the existing PATCH /api/recommendations/:id exactly once, and a viewer who
// could not write is offered no control at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RecStatus } from "@/lib/types";
import { stepFromRec, type DimensionStep } from "@/lib/org/dimensionStepsModel";
import { RepoDimensionNextSteps } from "./RepoDimensionNextSteps";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const step = (id: string, status: RecStatus, assigneeLogin: string | null = null): DimensionStep =>
  stepFromRec({
    id, title: `Step ${id}`, dimension: "D3", impact: "high", effort: "low", rationale: "", explore: [],
    status, assigneeLogin, targetDate: null, projectedPoints: 2,
  });

const base = { org: "acme", score: 52, tracked: true, canAct: true, viewerLogin: "ana" };

describe("RepoDimensionNextSteps", () => {
  it("a below-green dimension whose only step is dismissed says so and offers Reopen", () => {
    const { container } = render(<RepoDimensionNextSteps {...base} steps={[step("r2", "dismissed")]} />);
    expect(screen.getByText("1 dismissed, none open")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reopen/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/No follow-up on record/);
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("Start sends exactly one PATCH with the patchFor body, and a double-press does not send a second", async () => {
    let resolve!: (r: Partial<Response>) => void;
    const f = vi.fn(() => new Promise<Partial<Response>>((r) => (resolve = r)));
    vi.stubGlobal("fetch", f);
    render(<RepoDimensionNextSteps {...base} steps={[step("r1", "open")]} />);
    const start = screen.getByRole("button", { name: /Start/ });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/recommendations/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "in_progress", assigneeLogin: "ana" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...step("r1", "in_progress", "ana"), explore: [] }),
      });
    });
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a failed PATCH leaves the step in place and shows why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "Changed. Refresh." }) })));
    render(<RepoDimensionNextSteps {...base} steps={[step("r1", "open")]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    });
    expect(screen.getByText("Step r1")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Changed. Refresh.");
  });

  it("a read-only viewer (canAct false) is offered no Start/Done/Dismiss/Reopen", () => {
    render(
      <RepoDimensionNextSteps {...base} canAct={false} steps={[step("r1", "open"), step("r2", "dismissed")]} />,
    );
    for (const name of [/Start/, /Done/, /Dismiss/, /Reopen/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("a failed tracking read says the status is unknown rather than all open", () => {
    render(<RepoDimensionNextSteps {...base} tracked={false} trackingError canAct={false} steps={[]} />);
    expect(screen.getByText(/Couldn.t read this dimension.s tracked status/)).toBeTruthy();
  });
});
