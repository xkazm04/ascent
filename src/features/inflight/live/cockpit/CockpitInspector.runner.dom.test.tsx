// @vitest-environment jsdom
//
// THE RUNNER'S CTA IN THE RAIL (spark theater-upgrade, 2026-09-18). An owner with the loop enabled
// gets "Start standing runner…" beside Run and Drive — and with NOTHING selected too, because the
// runner's default scope is not the selection. It opens the setup dialog rather than starting
// anything. A viewer gets no runner CTA at all: not on the inspector (the CTA's own gate) and not on
// the rail (which shows the not-owner setup block instead of an inspector).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CockpitInspector } from "./CockpitInspector";
import { CockpitRail } from "./CockpitRail";
import type { ProposalBatch } from "./useProposalBatch";
import { INITIAL_DIALS } from "./useRunDials";

afterEach(cleanup);

const batch = (repos: string[]): ProposalBatch => ({
  repos,
  proposals: [],
  loading: false,
  pruned: new Set(),
  togglePrune: vi.fn(),
  unpaired: new Set(),
  runnable: repos,
  shares: { total: 0, rows: [] },
  dims: [],
  batches: {},
});

const inspector = (over: Partial<Parameters<typeof CockpitInspector>[0]> = {}) => {
  const onOpenRunner = vi.fn();
  render(
    <CockpitInspector batch={batch(["acme/a"])} dials={INITIAL_DIALS} onRun={vi.fn()} onDrive={vi.fn()} onOpenRunner={onOpenRunner} canRun {...over} />,
  );
  return { onOpenRunner };
};

describe("the runner CTA", () => {
  it("sits beside Run and Drive for an owner, and opens the dialog", () => {
    const { onOpenRunner } = inspector();
    expect(screen.getByRole("button", { name: /^Run \(1 repo\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drive to green" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start standing runner…" }));
    expect(onOpenRunner).toHaveBeenCalledOnce();
  });

  it("is offered with nothing selected — the runner's scope is not the selection", () => {
    inspector({ batch: batch([]) });
    expect(screen.getByText(/Lasso or click bodies/)).toBeInTheDocument();
    expect(screen.getByTestId("runner-cta")).toBeInTheDocument();
  });

  it("is not offered to a viewer, nor where running is blocked", () => {
    inspector({ canRun: false });
    expect(screen.queryByTestId("runner-cta")).toBeNull();
    cleanup();
    inspector({ canRun: false, batch: batch([]) });
    expect(screen.queryByTestId("runner-cta")).toBeNull();
    cleanup();
    inspector({ blockedReason: "The loop is off on this deployment." });
    expect(screen.queryByTestId("runner-cta")).toBeNull();
  });

  it("never reaches a viewer through the rail: a non-owner sees the setup block, not the inspector", () => {
    const noop = () => undefined;
    render(
      <CockpitRail
        slug="acme" mode="inspect" setup="not-owner" liveDrive={null} interruptedDrive={null} runDetail={null} runLive={false}
        batch={batch([])} dials={INITIAL_DIALS} canRun={false} busy={false} loopError={null} driveError={null} onRun={noop} onDrive={noop}
        onOpenRunner={noop} onStopRun={noop} onStopDrive={noop} onResumeDrive={noop} onDismissDrive={noop} onRetryLane={noop}
      />,
    );
    expect(screen.queryByTestId("runner-cta")).toBeNull();
    expect(screen.queryByRole("button", { name: /standing runner/i })).toBeNull();
  });
});
