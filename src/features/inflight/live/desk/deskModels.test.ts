// The small pure modules: format, route, table paging, search, flight-log geometry, the lane page's log.

import { describe, expect, it } from "vitest";
import { foldArms } from "./armsModel";
import { deskLanes, deskRounds } from "./deskFixture";
import { dur, usd, verdictKey, verdictWord } from "./deskFormat";
import { parseRoute, routeHash } from "./deskRoute";
import { flogGeometry, niceTicks } from "./flogModel";
import { logCounts, logLines } from "./laneDocModel";
import { foldRounds } from "./roundsModel";
import { searchHits, searchIndex } from "./searchModel";
import { roundFilters, tablePage } from "./tableModel";

const fold = foldRounds(deskRounds(), deskLanes());

describe("deskFormat", () => {
  it("never prints a missing cost as $0", () => {
    expect(usd(null)).toBeNull();
    expect(usd(62_000_000)).toBe("$0.62");
    expect(dur(3_720_000)).toBe("1 h 2 m");
    expect(verdictKey(null)).toBe("unknown");
    expect(verdictWord(null)).toBe("unknown (pre-guard)");
    expect(verdictKey("baseline-unavailable")).toBe("baseline");
  });
});

describe("deskRoute", () => {
  it("round-trips every address and refuses nonsense", () => {
    for (const r of [
      { kind: "round", runId: "run 1" },
      { kind: "lane", runId: "r", laneId: "l/1" },
      { kind: "log", runId: "r", laneId: "l" },
      { kind: "wait", key: "lessons" },
      { kind: "arm", key: "claude:sonnet plan -> pi:qwen" },
    ] as const)
      expect(parseRoute(routeHash(r))).toEqual(r);
    expect(parseRoute("#/w/bogus")).toBeNull();
    expect(parseRoute("#/")).toBeNull();
    expect(parseRoute("#ledger-needs-you")).toBeNull();
  });
});

describe("tableModel", () => {
  it("filters with counts and pages newest first", () => {
    const f = roundFilters(fold.rounds);
    expect(f.map((x) => x.id)).toEqual(["all", "closes", "rejected", "errored", "repo:acme/kp", "repo:acme/web"]);
    const page = tablePage(fold.rounds, f.find((x) => x.id === "errored")!, 0);
    expect(page.rows.map((r) => r.label)).toEqual(["#4"]);
    expect(tablePage(fold.rounds, f[0]!, 9)).toMatchObject({ page: 0, range: "1–4 of 4" });
  });
});

describe("searchModel", () => {
  it("finds rounds by number, repos and arms", () => {
    const idx = searchIndex(fold.rounds, foldArms(fold.rounds));
    expect(searchHits(idx, "#3").map((h) => h.title)).toEqual(["Round #3"]);
    expect(searchHits(idx, "web").map((h) => h.group)).toContain("Repos");
    expect(searchHits(idx, "qwen")[0]).toMatchObject({ group: "Arms", to: { kind: "arm" } });
    expect(searchHits(idx, "  ")).toEqual([]);
  });
});

describe("flogModel", () => {
  it("picks round ticks and never lets an empty history divide by zero", () => {
    expect(niceTicks(62, 3)).toEqual([50]);
    expect(niceTicks(10, 3)).toEqual([5, 10]);
    expect(niceTicks(0, 3)).toEqual([]);
    const g = flogGeometry([], 100);
    expect(g.W).toBe(640);
    expect(Number.isFinite(g.yC(1))).toBe(true);
  });
});

describe("laneDocModel", () => {
  it("splits the time off each line and marks good, warning and failure", () => {
    const lines = logLines(["17:33:36 Linked node_modules", "17:34:44 Degradation guard NARROWED — x", "17:54:44 Agent failed: timeout", "no time VERIFIED closed 2"]);
    expect(lines.map((l) => l.kind)).toEqual(["info", "warn", "bad", "good"]);
    expect(lines[0]).toMatchObject({ t: "17:33:36", text: "Linked node_modules" });
    expect(lines[3]!.t).toBe("");
    expect(logCounts(lines)).toEqual({ good: 1, warn: 1, bad: 1 });
  });
});
