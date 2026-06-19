import { describe, it, expect } from "vitest";
import type { SSEMessage } from "@/lib/sse";
import { applyScanEvent } from "./applyScanEvent";
import type { Constellation, RepoStar } from "./fleetMapStars";

function star(over: Partial<RepoStar> & { fullName: string }): RepoStar {
  return {
    name: over.fullName.split("/").pop() ?? over.fullName,
    private: false,
    overall: null,
    level: null,
    dOverall: null,
    watched: false,
    ...over,
  };
}

function fleet(): Constellation[] {
  return [
    { id: 1, login: "acme", status: "loading" },
    {
      id: 2,
      login: "globex",
      status: "done",
      repos: [star({ fullName: "globex/web" }), star({ fullName: "globex/api", overall: 40, level: "L2" })],
    },
    { id: 3, login: "initech", status: "error", message: "boom" },
  ];
}

const msg = (event: string | null, data: Record<string, unknown> | null): SSEMessage => ({ event, data });

describe("applyScanEvent — SSE event filter (the sole live-maturity write path)", () => {
  it("a well-formed `repo` event updates the right repo's stars in the matching done org", () => {
    const before = fleet();
    const after = applyScanEvent(before, "globex", msg("repo", { repo: "globex/web", overall: 87, level: "L4" }));
    const globex = after[1];
    expect(globex.status).toBe("done");
    if (globex.status !== "done") throw new Error("unreachable");
    const web = globex.repos.find((r) => r.fullName === "globex/web")!;
    expect(web.overall).toBe(87);
    expect(web.level).toBe("L4");
    // sibling repo untouched
    expect(globex.repos.find((r) => r.fullName === "globex/api")!.overall).toBe(40);
    // other orgs untouched
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it("INVARIANT: only the documented `repo` event type writes — a non-`repo`/unrelated event is ignored (same reference, no write)", () => {
    const before = fleet();
    for (const m of [
      msg("done", { repo: "globex/web", overall: 99 }),
      msg("error", { repo: "globex/web", overall: 99 }),
      msg(null, { repo: "globex/web", overall: 99 }),
      msg("repo", null), // keepalive-shaped: no data
    ]) {
      expect(applyScanEvent(before, "globex", m)).toBe(before);
    }
  });

  it("a malformed / out-of-range payload (error, skipped, missing repo, non-finite overall) is a no-op", () => {
    const before = fleet();
    for (const data of [
      { repo: "globex/web", overall: 50, error: "quota" }, // error flag
      { repo: "globex/web", overall: 0, skipped: true }, // skipped-with-zero must NOT paint a 0
      { overall: 50 }, // missing repo name
      { repo: "globex/web", overall: "not-a-number" }, // NaN overall
      { repo: "globex/web" }, // overall undefined -> NaN
    ]) {
      expect(applyScanEvent(before, "globex", msg("repo", data))).toBe(before);
    }
  });

  it("an event for an org that isn't `done` (loading/error) does not write any repo's score", () => {
    const before = fleet();
    // acme is loading, initech is errored — neither has a repos[] to write to.
    // (A guard-passing `repo` event still re-maps the outer array, as the inline original did, so we
    // assert value-equality — no repo's score changed — rather than reference identity here.)
    expect(applyScanEvent(before, "acme", msg("repo", { repo: "acme/x", overall: 70 }))).toStrictEqual(before);
    expect(applyScanEvent(before, "initech", msg("repo", { repo: "initech/y", overall: 70 }))).toStrictEqual(before);
  });

  it("an event for a repo not present in the org leaves every repo unchanged (no spurious add)", () => {
    const before = fleet();
    const after = applyScanEvent(before, "globex", msg("repo", { repo: "globex/ghost", overall: 70 }));
    const globex = after[1];
    if (globex.status !== "done") throw new Error("unreachable");
    expect(globex.repos).toHaveLength(2);
    expect(globex.repos.map((r) => r.overall)).toEqual([null, 40]);
  });

  it("does not double-apply: re-running the same event yields an equal repo and never duplicates a star", () => {
    const before = fleet();
    const once = applyScanEvent(before, "globex", msg("repo", { repo: "globex/web", overall: 87, level: "L4" }));
    const twice = applyScanEvent(once, "globex", msg("repo", { repo: "globex/web", overall: 87, level: "L4" }));
    const g1 = once[1];
    const g2 = twice[1];
    if (g1.status !== "done" || g2.status !== "done") throw new Error("unreachable");
    expect(g2.repos).toHaveLength(2);
    expect(g2.repos.find((r) => r.fullName === "globex/web")!.overall).toBe(87);
    // exactly one matching star, both times
    expect(g2.repos.filter((r) => r.fullName === "globex/web")).toHaveLength(1);
  });

  it("level absent on the payload normalizes to null (not the string 'undefined')", () => {
    const after = applyScanEvent(fleet(), "globex", msg("repo", { repo: "globex/api", overall: 55 }));
    const globex = after[1];
    if (globex.status !== "done") throw new Error("unreachable");
    expect(globex.repos.find((r) => r.fullName === "globex/api")!.level).toBeNull();
  });

  it("coerces a numeric-string overall (stream values arrive JSON-typed) to a finite number and writes it", () => {
    const after = applyScanEvent(fleet(), "globex", msg("repo", { repo: "globex/web", overall: "63" }));
    const globex = after[1];
    if (globex.status !== "done") throw new Error("unreachable");
    expect(globex.repos.find((r) => r.fullName === "globex/web")!.overall).toBe(63);
  });
});
