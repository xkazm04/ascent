// The two hosted-dispatch decisions useCockpit takes on top of the gate (ADR-0001): what an armed run
// sends, and which sentence the setup card renders. Pure, so pinned here rather than through the hook.

import { describe, expect, it } from "vitest";
import { armedStartInput, cockpitSetupMessage, type HostedDispatchFact } from "./cockpitGate";
import type { StartLoopInput } from "./loopClient";

const input = { repos: ["acme/web"], delivery: "land" } as StartLoopInput;

describe("armedStartInput", () => {
  it("stamps a hosted run with the hosted executor and forces pr delivery", () => {
    expect(armedStartInput(input, "hosted")).toMatchObject({ repos: ["acme/web"], executor: "hosted", delivery: "pr" });
  });

  it("leaves a local run exactly as the panel built it", () => {
    expect(armedStartInput(input, "local")).toBe(input);
  });
});

describe("cockpitSetupMessage", () => {
  const hosted: HostedDispatchFact = { enabled: false, reason: "This organization has reached its monthly ceiling.", available: true };

  // Only the server knows whether plan, ceiling, credit or admission refused, so its sentence wins.
  it("renders the server's reason on the hosted-not-enabled card", () => {
    expect(cockpitSetupMessage("hosted-not-enabled", hosted, "route error")).toBe(hosted.reason);
  });

  it("keeps the route's own error on every other card", () => {
    expect(cockpitSetupMessage("unpaired", hosted, "route error")).toBe("route error");
    expect(cockpitSetupMessage(null, hosted, null)).toBeNull();
  });

  it("renders nothing rather than a stale sentence when the server sent no hosted answer", () => {
    expect(cockpitSetupMessage("hosted-not-enabled", null, "route error")).toBeNull();
  });
});
