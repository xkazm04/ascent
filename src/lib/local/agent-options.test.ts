// The per-run agent configuration, as a value.
//
// Both halves matter for different reasons. The NORMALIZERS are a security boundary as much as a
// validation one: `--model` and `--effort` reach a re-parsing shell on Windows, so anything the route
// accepts has to come off a closed list rather than out of a request body. The LABEL is the honesty
// boundary: a run recorded before these columns existed has an unknown configuration, and printing
// "default" for it would be a claim about a run nobody can check.

import { describe, expect, it } from "vitest";
import {
  AGENT_EFFORTS,
  AGENT_MODELS,
  agentConfigLabel,
  normalizeAgentEffort,
  normalizeAgentModel,
} from "@/lib/local/agent-options";

describe("normalizeAgentModel", () => {
  it("accepts every model the picker offers, and nothing else", () => {
    for (const m of AGENT_MODELS) expect(normalizeAgentModel(m)).toBe(m);
    expect(normalizeAgentModel("gpt-4")).toBeNull();
    expect(normalizeAgentModel("")).toBeNull();
  });

  it("refuses anything that is not a plain known token — the value reaches a shell", () => {
    expect(normalizeAgentModel("sonnet; rm -rf /")).toBeNull();
    expect(normalizeAgentModel("sonnet && whoami")).toBeNull();
    expect(normalizeAgentModel(42)).toBeNull();
    expect(normalizeAgentModel(null)).toBeNull();
    expect(normalizeAgentModel(undefined)).toBeNull();
    expect(normalizeAgentModel({ toString: () => "sonnet" })).toBeNull();
  });
});

describe("normalizeAgentEffort", () => {
  it("accepts every level the picker offers, and nothing else", () => {
    for (const e of AGENT_EFFORTS) expect(normalizeAgentEffort(e)).toBe(e);
    // A level this build has never heard of drops the flag rather than becoming one.
    expect(normalizeAgentEffort("xhigh")).toBeNull();
    expect(normalizeAgentEffort("HIGH")).toBeNull();
    expect(normalizeAgentEffort(undefined)).toBeNull();
  });
});

describe("agentConfigLabel", () => {
  it("names both dials when both are known", () => {
    expect(agentConfigLabel({ model: "opus", effort: "high" })).toBe("opus · high effort");
  });

  it("names the model alone when no effort level was chosen", () => {
    // Null effort is NOT a level: the CLI flag is simply not passed, so there is nothing to print.
    expect(agentConfigLabel({ model: "sonnet", effort: null })).toBe("sonnet");
  });

  it("renders NOTHING for a run whose configuration was never recorded", () => {
    // The load-bearing case: a row written before the columns existed is unknown, and "default" would
    // be a claim about a run nobody can check.
    expect(agentConfigLabel(null)).toBeNull();
    expect(agentConfigLabel(undefined)).toBeNull();
    expect(agentConfigLabel({})).toBeNull();
    expect(agentConfigLabel({ model: null, effort: null })).toBeNull();
  });
});
