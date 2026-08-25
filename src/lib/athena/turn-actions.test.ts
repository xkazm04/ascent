// RAISING PROPOSALS FROM A TURN — the seam between what she said and what she offered.
//
// A sibling of turn.test.ts, kept separate so the seam test stays about the answer and this stays
// about the offer. Same fakes-not-mocks discipline: `actions.ts` and `blocks.ts` both run for real.
//
// The one that would bite hardest if it regressed is the ORDER: `parseAthenaBlocks` only consumes
// `athena:table` and `athena:chart` fences, so an action fence must be lifted out BEFORE it runs — or
// the operator reads the JSON of the offer as prose, above a card offering the same thing.

import { describe, it, expect } from "vitest";
import { runAthenaTurn, type AthenaEvent, type AthenaLoopRun, type AthenaTurnDeps } from "@/lib/athena/turn";
import { ATHENA_ACTION_CONTRACT, ATHENA_MAX_ACTIONS } from "@/lib/athena/actions";

const F = "```";
const fence = (body: unknown) => `${F}athena:action\n${JSON.stringify(body)}\n${F}`;

const HANDOFF = { action: "handoff_followups", params: { ids: ["r1", "r2"] } };
const RULING = {
  action: "rule_on_finding",
  params: { module: "security", itemKey: "acme/api::bp", ruling: "dismissed", rationale: "mirror" },
};

function fakes(text: string) {
  const appended: Parameters<AthenaTurnDeps["appendTurn"]>[0][] = [];
  const prompts: string[] = [];
  const run: AthenaLoopRun = {
    text,
    usage: { inputTokens: 10, outputTokens: 5 },
    legs: 1,
    toolCalls: [],
    truncated: false,
    grounding: "tools",
    engine: "openai",
    model: "gpt-test",
  };
  const deps: AthenaTurnDeps = {
    recall: async () => [],
    identity: async () => ({ constitution: null, selfModel: null }),
    history: async () => [],
    grounding: async () => ({ tools: [], execute: async () => "" }),
    runLoop: async (req) => {
      prompts.push(req.prompt);
      return run;
    },
    appendTurn: async (input) => {
      appended.push(input);
      return {
        id: `t${appended.length}`,
        threadId: "th1",
        role: input.role,
        content: input.content,
        meta: input.meta ?? {},
        inputTokens: null,
        outputTokens: null,
        legs: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    },
    writeEpisode: async () => null,
  };
  return { deps, appended, prompts };
}

async function turn(text: string) {
  const f = fakes(text);
  const events: AthenaEvent[] = [];
  for await (const e of runAthenaTurn({ orgSlug: "acme", threadId: "th1", message: "what next?", deps: f.deps })) {
    events.push(e);
  }
  const settled = events.find((e) => e.type === "settled");
  const assistant = f.appended.find((a) => a.role === "assistant");
  return { events, settled, assistant, prompts: f.prompts };
}

describe("an athena:action fence becomes a proposal on the assistant turn", () => {
  it("raises the proposal and hands it to appendTurn WITH the turn, not after it", async () => {
    const { assistant } = await turn(`Three are worth taking on.\n\n${fence(HANDOFF)}`);
    expect(assistant?.proposals).toEqual([
      { kind: "handoff_followups", payload: { params: { ids: ["r1", "r2"] } } },
    ]);
  });

  it("strips the fence out of the prose — the operator never reads the offer's JSON", async () => {
    const { assistant } = await turn(`Three are worth taking on.\n\n${fence(HANDOFF)}\n\nSay the word.`);
    expect(assistant?.content).not.toContain("athena:action");
    expect(assistant?.content).not.toContain("handoff_followups");
    expect(assistant?.content).toContain("Three are worth taking on.");
    expect(assistant?.content).toContain("Say the word.");
  });

  it("coexists with a block fence — actions first, then blocks, then the prose budget", async () => {
    const chart = `${F}athena:chart\n{"labels":["a","b"],"series":[{"name":"s","values":[1,2]}]}\n${F}`;
    const { assistant } = await turn(`Standing:\n\n${chart}\n\n${fence(RULING)}`);
    expect(assistant?.proposals).toHaveLength(1);
    expect((assistant?.meta?.blocks as unknown[])?.length).toBe(1);
    expect(assistant?.content).not.toContain("athena:");
  });

  it(`raises at most ${ATHENA_MAX_ACTIONS} and counts the rest as overflow`, async () => {
    const { assistant } = await turn([fence(HANDOFF), fence(RULING), fence(HANDOFF)].join("\n\n"));
    expect(assistant?.proposals).toHaveLength(ATHENA_MAX_ACTIONS);
    expect(assistant?.meta?.overflowActions).toBe(1);
  });

  it("DROPS a structurally wrong offer and COUNTS it — a vanished offer must be distinguishable from none", async () => {
    const { assistant } = await turn(`Here.\n\n${fence({ action: "wire_the_money", params: {} })}`);
    expect(assistant?.proposals).toEqual([]);
    expect(assistant?.meta?.droppedActions).toBe(1);
    expect(assistant?.content).not.toContain("wire_the_money");
  });

  it("drops an offer missing a required parameter rather than raising a card that cannot succeed", async () => {
    const { assistant } = await turn(fence({ action: "rule_on_finding", params: { module: "security" } }));
    expect(assistant?.proposals).toEqual([]);
    expect(assistant?.meta?.droppedActions).toBe(1);
  });

  it("raises nothing, and counts nothing, for an ordinary reply", async () => {
    const { assistant } = await turn("The fleet averages 62 of 100.");
    expect(assistant?.proposals).toEqual([]);
    expect(assistant?.meta?.droppedActions).toBe(0);
    expect(assistant?.meta?.overflowActions).toBe(0);
  });
});

describe("she is taught the catalog she is validated against", () => {
  it("ships the generated action contract in the prompt", async () => {
    const { prompts } = await turn("ok");
    expect(prompts[0]).toContain(ATHENA_ACTION_CONTRACT);
  });
});
