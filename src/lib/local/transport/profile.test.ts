// THE REGISTRY, AND THE TWO CONSTANTS IT REPLACES.
//
// The pinning tests at the bottom are the ones that matter while `PLAN_TIMEOUT_MS` and
// `PHASE_QUIET_MS` still exist: a deprecation that lets its replacement drift from the thing it
// replaced is worse than no deprecation, because both numbers then look authoritative.

import { describe, expect, it } from "vitest";
import { TRANSPORT_IDS } from "@/lib/local/arm";
import { allTransportProfiles, transportProfile, transportTiming } from "@/lib/local/transport/profile";
import { claudeHostedTiming, claudeLocalTiming } from "@/lib/local/transport/claude";
import { PHASE_QUIET_MS, PLAN_TIMEOUT_MS } from "@/lib/local/runner-types";

describe("the transport registry", () => {
  it("resolves every id in the closed list, and each profile answers to its own id", () => {
    for (const id of TRANSPORT_IDS) expect(transportProfile(id).id).toBe(id);
  });

  it("lists every transport exactly once — the cockpit's picker is this list", () => {
    const ids = allTransportProfiles().map((p) => p.id);
    expect(ids).toEqual([...TRANSPORT_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every profile a positive band on all three ceilings", () => {
    // A zero or missing ceiling is a lane with no tripwire, which is the failure mode the watchdog
    // exists to prevent — not a valid "no timeout" configuration.
    for (const p of allTransportProfiles()) {
      for (const k of ["agentMs", "planMs", "quietMs"] as const) expect(p.timing[k], `${p.id}.${k}`).toBeGreaterThan(0);
    }
  });
});

describe("transportTiming", () => {
  it("returns the transport's own band by default", () => {
    expect(transportTiming("claude")).toEqual(claudeHostedTiming);
    expect(transportTiming("claude", null)).toEqual(claudeHostedTiming);
    expect(transportTiming("claude", { local: false })).toEqual(claudeHostedTiming);
  });

  it("widens the Claude band when the arm points at a LOCAL endpoint", () => {
    expect(transportTiming("claude", { local: true })).toEqual(claudeLocalTiming);
  });

  it("falls through to a transport's own band when no local band was MEASURED for it", () => {
    // Pi has no measured local band yet. Inventing one would be exactly what the dated matrix
    // refuses: an unverified number presented as a ceiling.
    expect(transportTiming("pi", { local: true })).toEqual(transportProfile("pi").timing);
  });
});

describe("the constants the profiles supersede", () => {
  it("pins PLAN_TIMEOUT_MS to the Claude profile's plan band", () => {
    // Two call sites still read the constant (`lane-plan.ts`, `loop-lane.ts`); this is what stops the
    // two numbers becoming two answers while both exist.
    expect(PLAN_TIMEOUT_MS).toBe(claudeHostedTiming.planMs);
  });

  it("pins PHASE_QUIET_MS to the Claude profile's quiet band", () => {
    expect(PHASE_QUIET_MS).toBe(claudeHostedTiming.quietMs);
  });
});
