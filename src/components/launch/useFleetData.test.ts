import { describe, expect, it } from "vitest";
import { settleInitialFetch } from "./useFleetData";

// ambiguity-ui-scan-2026-07-16 launch-fleet-map #2: a 200 response with a malformed/absent JSON body
// used to be committed as `done` with zero repos — rendering the confident "no repositories" empty
// state for a transient gateway blip. It must settle as an ERROR (matching mergeStars' "empty means
// failure" rule on refresh), while a genuinely empty org (`repos: []`) still settles `done`.

const inst = { id: 7, login: "acme" };

describe("settleInitialFetch — initial /api/app/repos commit", () => {
  it("commits done with mapped repos for a well-formed payload", () => {
    const c = settleInitialFetch(inst, true, 200, {
      repos: [{ fullName: "acme/web", state: { level: "L4", overall: 72, watched: true } }],
    });
    expect(c).toEqual({
      id: 7,
      login: "acme",
      status: "done",
      repos: [{ fullName: "acme/web", overall: 72, level: "L4", dOverall: null, watched: true }],
    });
  });

  it("commits done for a genuinely empty org (repos: [])", () => {
    const c = settleInitialFetch(inst, true, 200, { repos: [] });
    expect(c).toEqual({ id: 7, login: "acme", status: "done", repos: [] });
  });

  it("commits ERROR (not a false empty state) for a 200 whose body failed to parse", () => {
    const c = settleInitialFetch(inst, true, 200, null);
    expect(c.status).toBe("error");
    if (c.status !== "error") throw new Error("unreachable");
    expect(c.message).toMatch(/couldn't read repositories/i);
  });

  it("commits ERROR for a 200 whose shape drifted (repos missing or not an array)", () => {
    for (const data of [{}, { repos: "nope" }, { repos: { a: 1 } }] as { repos?: unknown }[]) {
      const c = settleInitialFetch(inst, true, 200, data);
      expect(c.status).toBe("error");
    }
  });

  it("keeps the non-OK path: server error message when present, status fallback otherwise", () => {
    const withMsg = settleInitialFetch(inst, false, 403, { error: "No access to acme." });
    expect(withMsg).toEqual({ id: 7, login: "acme", status: "error", message: "No access to acme." });
    const noMsg = settleInitialFetch(inst, false, 502, null);
    expect(noMsg).toEqual({ id: 7, login: "acme", status: "error", message: "Failed (502)" });
  });
});
