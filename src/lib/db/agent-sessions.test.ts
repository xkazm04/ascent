import { describe, expect, it } from "vitest";
import { buildAttemptRollup, buildUnitEconomics } from "./agent-sessions";

type Row = Parameters<typeof buildAttemptRollup>[0][number];

const row = (over: Partial<Row> = {}): Row => ({
  repoFullName: "acme/web",
  userKey: "dev@acme.io",
  startedAt: new Date("2026-08-01T00:00:00Z"),
  tokens: 1000,
  costCents: 100,
  commits: 1,
  pullRequests: 0,
  linesAdded: 50,
  ...over,
});

describe("buildAttemptRollup", () => {
  it("aggregates per repo and counts distinct people", () => {
    const r = buildAttemptRollup([
      row({ userKey: "a@x.io", costCents: 100 }),
      row({ userKey: "b@x.io", costCents: 250 }),
      row({ repoFullName: "acme/api", userKey: "a@x.io", costCents: 90 }),
    ]);
    expect(r.repos.map((x) => x.repoFullName)).toEqual(["acme/web", "acme/api"]); // cost desc
    expect(r.repos[0]).toMatchObject({ sessions: 2, costCents: 350, people: 2 });
    expect(r.totals).toMatchObject({ sessions: 3, costCents: 440, people: 2 }); // a@x.io counted once
  });

  // A session that produced a commit OR a PR produced code. Both, or either, counts once.
  it("counts a session as producing code on a commit or a PR", () => {
    const r = buildAttemptRollup([
      row({ commits: 1, pullRequests: 0 }),
      row({ commits: 0, pullRequests: 1 }),
      row({ commits: 3, pullRequests: 2 }),
      row({ commits: 0, pullRequests: 0 }),
    ]);
    expect(r.repos[0]).toMatchObject({ sessions: 4, producedCode: 3 });
  });

  it("records a session with no user rather than dropping it", () => {
    const r = buildAttemptRollup([row({ userKey: null })]);
    expect(r.totals.sessions).toBe(1);
    expect(r.totals.people).toBe(0);
  });

  it("reports the window the sessions actually span", () => {
    const r = buildAttemptRollup([
      row({ startedAt: new Date("2026-08-05T00:00:00Z") }),
      row({ startedAt: new Date("2026-08-01T00:00:00Z") }),
      row({ startedAt: new Date("2026-08-09T00:00:00Z") }),
    ]);
    expect(r.from).toBe("2026-08-01T00:00:00.000Z");
    expect(r.to).toBe("2026-08-09T00:00:00.000Z");
  });

  it("is empty-safe", () => {
    const r = buildAttemptRollup([]);
    expect(r).toMatchObject({ repos: [], from: null, to: null });
    expect(r.totals).toMatchObject({ sessions: 0, producedCode: 0, costCents: 0, people: 0 });
  });
});

describe("buildUnitEconomics", () => {
  const rollup = buildAttemptRollup([
    row({ costCents: 400, commits: 1 }),
    row({ costCents: 300, commits: 1 }),
    row({ costCents: 300, commits: 0, pullRequests: 0 }),
  ]);

  it("divides total cost by the sessions that produced code", () => {
    const [e] = buildUnitEconomics(rollup, new Map());
    // 1000c over 2 producing sessions.
    expect(e).toMatchObject({ sessions: 3, producedCode: 2, costCents: 1000, costPerProducingSession: 500 });
  });

  // NOT a success rate — named for what it measures, because a session with no commit is frequently
  // a question, a code read or a debugging pass, and calling those failures would be an over-claim.
  it("reports the produced-code share as a rate, not a verdict", () => {
    expect(buildUnitEconomics(rollup, new Map())[0]!.producedRate).toBe(67);
  });

  it("allocates cost over merged AI changes in the same repo and period", () => {
    const [e] = buildUnitEconomics(rollup, new Map([["acme/web", 4]]));
    expect(e!.costPerMergedAiChange).toBe(250); // 1000c / 4
    expect(e!.mergedAiChanges).toBe(4); // the denominator is published so the figure can be judged
  });

  // "No denominator" and "free" are different statements, and only one of them is true.
  it("returns null — not zero — when the repo merged no AI-attributed change", () => {
    const [e] = buildUnitEconomics(rollup, new Map());
    expect(e!.costPerMergedAiChange).toBeNull();
    expect(e!.mergedAiChanges).toBe(0);
  });

  it("returns null cost-per-producing-session when nothing produced code", () => {
    const none = buildAttemptRollup([row({ commits: 0, pullRequests: 0, costCents: 900 })]);
    const [e] = buildUnitEconomics(none, new Map());
    expect(e!.costPerProducingSession).toBeNull();
    expect(e!.producedRate).toBe(0); // measured and zero, which IS a fact — distinct from unknown
  });

  it("matches repos case-folded, the same folding the session mapper applies", () => {
    const [e] = buildUnitEconomics(buildAttemptRollup([row({ repoFullName: "acme/web" })]), new Map([["acme/web", 2]]));
    expect(e!.costPerMergedAiChange).not.toBeNull();
  });
});
