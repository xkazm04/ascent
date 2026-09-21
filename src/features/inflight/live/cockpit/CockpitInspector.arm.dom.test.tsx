// @vitest-environment jsdom
//
// NOTHING DEPARTS ON A CONFIGURATION NOTHING HAS CLEARED (spark local-model-lanes, 2026-09-21).
//
// The preflight probe's whole value is spent if the run starts anyway: the two measured failures it
// catches produce a wrong ANSWER rather than an error, hours of wall clock later. So a `blocked`
// probe disables Run, Drive AND the standing runner — the runner most of all, since it spends against
// a daily ceiling on the same unproven transport.
//
// And it is never a silently dead button: the reason is on screen and each disabled control points at
// it (`aria-describedby`), so it is reachable by eye and by a screen reader.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CockpitInspector } from "./CockpitInspector";
import { newArmDraft } from "./arms/armDraft";
import type { ProposalBatch } from "./useProposalBatch";
import { INITIAL_DIALS, type RunDials } from "./useRunDials";

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

const inspector = (dials: Partial<RunDials>, repos = ["acme/a"]) =>
  render(
    <CockpitInspector
      batch={batch(repos)}
      dials={{ ...INITIAL_DIALS, ...dials }}
      onRun={vi.fn()}
      onDrive={vi.fn()}
      onOpenRunner={vi.fn()}
      canRun
    />,
  );

const runBtn = () => screen.getByRole("button", { name: /^Run \(1 repo\)$/ });
const driveBtn = () => screen.getByRole("button", { name: "Drive to green" });

describe("the CTA and the preflight probe", () => {
  it("starts on an unprobed configuration — the probe is a deliberate press, not a toll", () => {
    inspector({ armProbe: "idle" });
    expect(runBtn()).toBeEnabled();
    expect(driveBtn()).toBeEnabled();
    expect(screen.getByTestId("runner-cta")).toBeEnabled();
    expect(screen.queryByTestId("arm-block")).toBeNull();
  });

  it("a REFUSED probe disables all three starts and says why, where the button points", () => {
    inspector({ armProbe: "blocked" });
    const note = screen.getByTestId("arm-block");
    expect(note).toHaveTextContent(/probe refused/i);
    for (const b of [runBtn(), driveBtn(), screen.getByTestId("runner-cta")]) {
      expect(b).toBeDisabled();
      // Reachable, not merely adjacent: the control names the element carrying its reason.
      expect(b.getAttribute("aria-describedby")).toBe(note.id);
    }
  });

  it("disables the runner CTA with its reason even with nothing selected", () => {
    inspector({ armProbe: "blocked" }, []);
    expect(screen.getByTestId("runner-cta")).toBeDisabled();
    expect(screen.getByTestId("arm-block")).toHaveTextContent(/probe refused/i);
  });

  it("refuses a half-typed arm too — a run armed with nothing is not the run that was configured", () => {
    inspector({ arms: [{ ...newArmDraft("pi"), model: "" }] });
    expect(runBtn()).toBeDisabled();
    expect(screen.getByTestId("arm-block")).toHaveTextContent(/not armable/i);
  });
});
