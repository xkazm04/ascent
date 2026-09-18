// The sky's pure core: what the memory remembers (and forgets), which ring each repo lands on and
// why, and the one sentence the narration says — pinned without a renderer.

import { describe, expect, it } from "vitest";
import type { LaneActivity, LoopPulse, RepoRunnerState } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt, fixtureRunner } from "../../theaterFixture";
import { emptyMemory, foldPulse, landingsToday } from "./skyMemory";
import { skyModel } from "./skyModel";
import { fitNarration, narrationClauses, sentence } from "./skyNarration";
import { TAIL_KEEP } from "./skyConstants";

const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const act = (s: number, kind: LaneActivity["kind"] = "read", path = `src/f${s}.ts`): LaneActivity => ({ at: iso(s), kind, path, tool: null, note: null });
const fold = (...pulses: LoopPulse[]) => pulses.reduce((m, p, i) => foldPulse(m, p, DEMO_EPOCH + i * 1000), emptyMemory(DEMO_EPOCH));
const repoState = (o: Partial<RepoRunnerState>): RepoRunnerState => ({
  repo: "acme/docs",
  baseBranch: "main",
  paused: null,
  pausedUntil: null,
  note: null,
  failureStreak: 0,
  dryStreak: 0,
  lastMergeInSha: null,
  lastLandedSha: null,
  aheadOfBase: null,
  ...o,
});

describe("skyMemory", () => {
  it("keeps a lane's events across pulses, deduped, oldest first, bounded", () => {
    const lane = (tail: LaneActivity[]) => fixturePulse({ lanes: [fixtureLane({ tail })] });
    const mem = fold(lane([act(1), act(2)]), lane([act(2), act(3)]), lane([act(3), act(4)]));
    expect(mem.lanes["lane-kp"]!.events.map((e) => e.path)).toEqual(["src/f1.ts", "src/f2.ts", "src/f3.ts", "src/f4.ts"]);
    expect(mem.lanes["lane-kp"]!.reads).toBe(4);
    // Only what arrived after the first pulse is entitled to an entrance.
    expect(mem.lanes["lane-kp"]!.events.map((e) => e.fresh)).toEqual([false, false, true, true]);
    const many = Array.from({ length: TAIL_KEEP + 10 }, (_, i) => lane([act(i)]));
    expect(fold(...many).lanes["lane-kp"]!.events).toHaveLength(TAIL_KEEP);
  });

  it("resets a lane when its session changes and forgets a lane that left the pulse", () => {
    const a = fixturePulse({ lanes: [fixtureLane({ startedAt: iso(0), tail: [act(1)] })] });
    const b = fixturePulse({ lanes: [fixtureLane({ startedAt: iso(100), tail: [act(101)] })] });
    expect(fold(a, b).lanes["lane-kp"]!.events.map((e) => e.path)).toEqual(["src/f101.ts"]);
    expect(fold(a, fixturePulse({ lanes: [] })).lanes).toEqual({});
  });

  it("treats the first pulse's events as history and later ones as arrivals", () => {
    const landed = { at: iso(5), repo: "acme/kp", kind: "landed" as const, headline: "kp landed" };
    const base = fixturePulse();
    const mem = fold(base, { ...base, latest: [landed, ...base.latest] });
    expect(mem.events.filter((e) => e.arrived).map((e) => e.event)).toEqual([landed]);
    expect(mem.events.filter((e) => !e.arrived)).toHaveLength(base.latest.length);
    // A landed and its verified-close at the same instant are ONE landing moment.
    const both = fold(base, { ...base, latest: [landed, { ...landed, kind: "verified-close", headline: "kp closed" }, ...base.latest] });
    expect(landingsToday(both, "acme/kp", DEMO_EPOCH + 10_000) - landingsToday(fold(base), "acme/kp", DEMO_EPOCH + 10_000)).toBe(1);
  });
});

describe("skyModel", () => {
  it("rings are runner state: at work, next up, resting", () => {
    const p = fixturePulse({
      lanes: [fixtureLane(), fixtureLane({ laneId: "lane-api", repo: "acme/api", phase: "done" })],
      waiting: ["acme/web"],
      runner: fixtureRunner({ repos: [repoState({ paused: "branch-conflict" })] }),
    });
    const m = skyModel(p, fold(p), DEMO_EPOCH);
    const ring = (r: string) => m.bodies.find((b) => b.repo === r)?.ring;
    expect([ring("acme/kp"), ring("acme/api"), ring("acme/web"), ring("acme/docs")]).toEqual([0, 1, 1, 2]);
    expect(m.bodies.find((b) => b.repo === "acme/api")!.note).toBe("done this cycle");
    const docs = m.bodies.find((b) => b.repo === "acme/docs")!;
    expect([docs.note, docs.noteTone]).toEqual(["paused · branch conflict", "attention"]);
    // Known only from events: a past body with its last event, never invented state.
    expect(m.bodies.find((b) => b.repo === "acme/systedo")).toMatchObject({ ring: 2, tone: "past" });
  });

  it("the idle sky rests with the next wake; a paused runner holds everything", () => {
    const idle = fixturePulseAt(DEMO_EPOCH, "idle");
    const m = skyModel(idle, fold(idle), DEMO_EPOCH);
    expect(m.core.tone).toBe("rest");
    expect(m.nextWake?.repo).toBe("acme/kp");
    expect(m.bodies.find((b) => b.repo === "acme/kp")!.note).toMatch(/^rests until \d\d:\d\d$/);
    const held = fixturePulseAt(DEMO_EPOCH, "paused-spend");
    const h = skyModel(held, fold(held), DEMO_EPOCH);
    expect([h.holding, h.core.tone, h.core.why]).toEqual([true, "hold", "daily spend ceiling"]);
  });

  it("a quiet lane says so, in the lane-phase vocabulary", () => {
    const p = fixturePulse({ lanes: [fixtureLane({ phase: "agent-quiet", tail: [act(-400)], heartbeatAt: iso(-400), phaseSince: iso(-600) })] });
    const m = skyModel(p, fold(p), DEMO_EPOCH);
    expect(m.bodies[0]!.phase).toMatch(/^Still working — quiet for \d+m/);
    expect(sentence(narrationClauses(m, DEMO_EPOCH, []))).toMatch(/kp has been quiet for \d+m/);
  });
});

describe("narration", () => {
  it("tells the running sky in one sentence, landing first", () => {
    const p = fixturePulseAt(DEMO_EPOCH + 95_000);
    const m = skyModel(p, fold(p), DEMO_EPOCH + 95_000);
    const text = sentence(narrationClauses(m, DEMO_EPOCH + 95_000, ["systedo"]));
    expect(text).toMatch(/^kp is editing src\/\S+ · systedo just landed and is planning its next change · web waits for a slot$/);
  });

  it("names paused repos the operator must lift", () => {
    const p = fixturePulse({ lanes: [], runner: fixtureRunner({ repos: [repoState({ paused: "repo-failures" })] }) });
    const m = skyModel(p, fold(p), DEMO_EPOCH);
    expect(sentence(narrationClauses(m, DEMO_EPOCH, []))).toContain("docs is paused — failures in a row");
  });

  it("fits instead of wrapping: smaller size, then file names, then '+N more' — the full text stays whole", () => {
    const lanes = ["alpha", "beta", "gamma", "delta", "epsilon"].map((r) =>
      fixtureLane({ laneId: `lane-${r}`, repo: `acme/${r}`, tail: [act(1, "edit", `packages/${r}/src/deeply/nested/module/file.ts`)] }),
    );
    const p = fixturePulse({ lanes });
    const m = skyModel(p, fold(p), DEMO_EPOCH);
    const wide = fitNarration(m, DEMO_EPOCH, [], 10_000);
    expect(wide.size).toBe("display");
    const tight = fitNarration(m, DEMO_EPOCH, [], 900);
    expect(tight.size).toBe("heading");
    expect(sentence(tight.clauses)).toMatch(/\+\d+ more$/);
    expect(tight.full).toBe(wide.full);
    expect(tight.full).toContain("packages/epsilon/src/deeply/nested/module/file.ts");
  });
});
