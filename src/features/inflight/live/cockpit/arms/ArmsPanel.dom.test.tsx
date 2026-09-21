// @vitest-environment jsdom
//
// THE TWO THINGS THE PANEL MUST NOT GET WRONG, driven through the real components over a fetch stub:
// a failed probe BLOCKS and prints the operator's next action verbatim, and a below-floor arm cannot
// be armed without the deliberate opt-in.
//
// The host below is exactly the wiring `AgentSection` uses (state in, three callbacks out), so what
// is pinned is the contract the dialog relies on rather than a fixture of it.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArmPolicy } from "@/lib/local/arm";
import type { ProbeResult } from "@/lib/local/transport/probe";
import { ArmsPanel } from "./ArmsPanel";
import { newArmDraft, type ArmDraft } from "./armDraft";
import type { ArmProbePhase } from "./useArmProbe";

const CONTEXT_REMEDY = "set OLLAMA_CONTEXT_LENGTH to 65536 and restart the server";

const blockedProbe: ProbeResult = {
  transport: "pi",
  ok: false,
  binVersion: "0.32.15",
  serverVersion: "0.32.15",
  at: "2026-09-21T10:00:00.000Z",
  zeroToken: true,
  findings: [
    { check: "binary", ok: true, observed: "pi 0.32.15" },
    { check: "context", ok: false, observed: "4096", required: "65536", remedy: CONTEXT_REMEDY },
  ],
};

const okProbe = (): ProbeResult => ({ transport: "claude", ok: true, at: "2026-09-21T10:00:00.000Z", zeroToken: true, findings: [] });

let phases: ArmProbePhase[] = [];
let reply: ProbeResult = okProbe();
const REFUSAL = "pi is not ready on this machine.";

function Host({ initial }: { initial?: ArmDraft[] }) {
  const [policy, setPolicy] = useState<ArmPolicy>("single");
  const [arms, setArms] = useState<ArmDraft[]>(initial ?? [newArmDraft()]);
  return (
    <ArmsPanel
      policy={policy}
      arms={arms}
      onPolicy={(p, next) => {
        setPolicy(p);
        setArms(next);
      }}
      onArms={setArms}
      onPhase={(p) => phases.push(p)}
    />
  );
}

beforeEach(() => {
  // The probe reads the org from the cockpit's own address at press time — no router mock needed.
  window.history.replaceState({}, "", "/org/acme?tab=live");
  phases = [];
  reply = okProbe();
  vi.stubGlobal(
    "fetch",
    // The route's real shape: { probe, refusal } — see src/app/api/org/local/probe/route.ts.
    vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ probe: reply, refusal: reply.ok ? null : REFUSAL }) }) as Response,
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const press = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

describe("ArmsPanel", () => {
  it("arms a single Claude arm by default and reads ready once the probe passes", async () => {
    render(<Host />);
    expect(screen.getByTestId("arm-label-0")).toHaveTextContent("claude:sonnet");
    expect(screen.queryByTestId("arm-unarmable")).toBeNull();

    await press("arm-probe-run");
    expect(screen.getByTestId("arm-probe")).toHaveAttribute("data-state", "armable");
    expect(phases).toEqual(["probing", "armable"]);
  });

  it("blocks arming on a failed probe and prints the named remedy", async () => {
    reply = blockedProbe;
    render(<Host />);
    await press("arm-probe-run");

    expect(screen.getByTestId("arm-probe")).toHaveAttribute("data-state", "blocked");
    expect(screen.getByTestId("arm-probe-state")).toHaveTextContent("Blocked");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(REFUSAL);
    expect(alert).toHaveTextContent("4096 — 65536 required");
    expect(alert).toHaveTextContent(CONTEXT_REMEDY);
    // The phase the CTA gates on — `blocked` is what disables the button that arms the run.
    expect(phases.at(-1)).toBe("blocked");
  });

  it("goes back to unchecked when the arms change under a green light", async () => {
    render(<Host />);
    await press("arm-probe-run");
    expect(screen.getByTestId("arm-probe")).toHaveAttribute("data-state", "armable");

    await act(async () => {
      fireEvent.click(screen.getByTestId("setup-arm-policy").querySelectorAll("button")[1]);
    });
    expect(screen.getByTestId("arm-probe")).toHaveAttribute("data-state", "idle");
  });

  it("refuses a below-floor arm until the opt-in is ticked, then marks it", async () => {
    render(<Host />);
    // Switch the executing half to the local transport: the planning half goes with it.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Arm 1 executing transport").querySelectorAll("button")[1]);
    });
    expect(screen.getByTestId("arm-below-floor-0")).toBeTruthy();
    expect(screen.getByTestId("arm-unarmable")).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Arm 1 executing model"), { target: { value: "qwen3.8:27b" } });
    });
    // A valid model is not enough — the opt-in is the second gate, and the probe stays disabled.
    expect(screen.getByTestId("arm-unarmable")).toBeTruthy();
    expect(screen.getByTestId("arm-probe-run")).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Arm it below the floor anyway"));
    });
    expect(screen.queryByTestId("arm-unarmable")).toBeNull();
    expect(screen.getByTestId("arm-probe-run")).not.toBeDisabled();
    expect(screen.getByTestId("arm-label-0")).toHaveTextContent("pi:qwen3.8:27b");
  });

  it("grows to two arms in compare, adds up to four, and names a split arm as the split it is", async () => {
    render(<Host />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("setup-arm-policy").querySelectorAll("button")[1]);
    });
    expect(screen.getAllByTestId(/^arm-row-/)).toHaveLength(2);

    await press("arm-add");
    await press("arm-add");
    expect(screen.getAllByTestId(/^arm-row-/)).toHaveLength(4);
    expect(screen.queryByTestId("arm-add")).toBeNull();

    // Arm 4: Claude plans, the local model executes.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Arm 4 executing transport").querySelectorAll("button")[1]);
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Arm 4 executing model"), { target: { value: "qwen3.8:27b" } });
    });
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/^Plan with a different model/)[3]);
    });
    expect(screen.getByTestId("arm-label-3")).toHaveTextContent("claude:sonnet plan -> pi:qwen3.8:27b");
    expect(screen.queryByTestId("arm-below-floor-3")).toBeNull();

    await press("arm-remove-3");
    expect(screen.getAllByTestId(/^arm-row-/)).toHaveLength(3);
  });
});
