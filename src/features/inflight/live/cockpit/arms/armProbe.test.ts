// THE BROWSER EDGE'S READING OF THE REPLY — attribution, the request it sends, and the refusal to
// treat an unreadable answer as a pass.

import { afterEach, describe, expect, it, vi } from "vitest";

import { allArmsOk, allZeroToken, blockedChecks, findingSentence, probeArmsOverHttp } from "./armProbe";
import { CONTEXT_MISS, probeFixture, replyFixture } from "./armProbeFixture";

afterEach(() => vi.unstubAllGlobals());

const hosted = probeFixture("claude");
const local = probeFixture("pi", CONTEXT_MISS);

describe("blockedChecks", () => {
  it("attributes a shared probe's failure to every arm that depends on it", () => {
    const reply = replyFixture(
      [hosted, local],
      [
        { armId: "a", label: "claude", execProbe: 0 },
        { armId: "b", label: "local one", execProbe: 1 },
        { armId: "c", label: "local two", execProbe: 1 },
      ],
    );
    expect(blockedChecks(reply).map((f) => f.armId)).toEqual(["b", "c"]);
    expect(blockedChecks(reply).every((f) => f.finding.check === "context")).toBe(true);
  });

  it("lists a split arm's two halves separately, and a non-split arm's shared probe once", () => {
    const split = replyFixture([hosted, local], [{ armId: "s", label: "split", execProbe: 1, planProbe: 0 }]);
    expect(blockedChecks(split).map((f) => f.role)).toEqual(["execute"]);

    const both = replyFixture([local, local], [{ armId: "s", label: "split", execProbe: 0, planProbe: 1 }]);
    expect(blockedChecks(both).map((f) => f.role)).toEqual(["execute", "plan"]);

    const plain = replyFixture([local], [{ armId: "p", label: "plain", execProbe: 0 }]);
    expect(blockedChecks(plain)).toHaveLength(1);
  });

  it("is empty for a null reply and for an all-green one", () => {
    expect(blockedChecks(null)).toEqual([]);
    expect(blockedChecks(replyFixture([hosted], [{ armId: "a", label: "a", execProbe: 0 }]))).toEqual([]);
  });
});

describe("the verdicts", () => {
  it("treats a reply with no arms as NOT armable — nothing was proven", () => {
    expect(allArmsOk(null)).toBe(false);
    expect(allArmsOk({ arms: [], probes: [], refusal: null })).toBe(false);
    expect(allArmsOk(replyFixture([hosted], [{ armId: "a", label: "a", execProbe: 0 }]))).toBe(true);
  });

  it("reads zero-token off every probe", () => {
    expect(allZeroToken(replyFixture([hosted], [{ armId: "a", label: "a", execProbe: 0 }]))).toBe(true);
    const spent = replyFixture([{ ...hosted, zeroToken: false }], [{ armId: "a", label: "a", execProbe: 0 }]);
    expect(allZeroToken(spent)).toBe(false);
  });
});

describe("findingSentence", () => {
  it("prints the gap and the action, and degrades rather than inventing either", () => {
    expect(findingSentence(CONTEXT_MISS)).toBe(
      "4096 — 65536 required. set OLLAMA_CONTEXT_LENGTH to 65536 and restart the server",
    );
    expect(findingSentence({ check: "binary", ok: false })).toBe("check failed.");
    expect(findingSentence({ check: "binary", ok: false, observed: "exit 1" })).toBe("exit 1.");
  });
});

describe("probeArmsOverHttp", () => {
  const arms = [{ id: "a", transport: "claude", model: "sonnet", plan: null }];

  it("sends the arms and the policy, and no endpoint — the deployment answers that", async () => {
    const reply = replyFixture([hosted], [{ armId: "a", label: "a", execProbe: 0 }]);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => reply }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await probeArmsOverHttp("acme", arms, "single");
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body).toEqual({ org: "acme", arms, armPolicy: "single" });
    expect(body.endpoint).toBeUndefined();
  });

  it("throws the route's own error on a non-2xx, and on a body it cannot read", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403, json: async () => ({ error: "Forbidden." }) }) as Response);
    await expect(probeArmsOverHttp("acme", arms, "single")).rejects.toThrow("Forbidden.");

    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ probe: {} }) }) as Response);
    await expect(probeArmsOverHttp("acme", arms, "single")).rejects.toThrow("Could not probe the arms.");
  });
});
