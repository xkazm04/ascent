// THE LANE-EXIT DOOR (challenge-2026-09-23, card live-war-room#A).
//
// Three things are pinned here:
//   • the obligations TABLE is exhaustive over the closed vocabulary, and its load-bearing rows say
//     what the lane used to decide site by site;
//   • the DOOR keeps its order — flush the tail, release or transfer the claim, settle the plan, then
//     one terminal row — and reports the result the table implies;
//   • EVERY EXIT GOES THROUGH IT: loop-lane.ts, comments and strings stripped, holds no hand-rolled
//     release, no direct plan settle and no terminal row write. A seeded violation proves the matcher
//     still bites, and a prose-only one proves it reads code rather than words.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const released: { ids: readonly string[]; why: string }[] = [];
const patches: Record<string, unknown>[] = [];

vi.mock("@/lib/db/followup-claims", () => ({
  releaseFollowups: vi.fn(async (ids: readonly string[], why: string) => {
    order.push("release");
    released.push({ ids: [...ids], why });
    return ids.length;
  }),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  appendLaneLog: vi.fn(async () => {
    order.push("log");
  }),
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    order.push("row");
    patches.push(patch);
    return {};
  }),
}));

import { createLaneExitContext, exitLane, LANE_EXIT_KINDS, laneExitObligations } from "@/lib/local/lane-exit";

beforeEach(() => {
  order.length = 0;
  released.length = 0;
  patches.length = 0;
});

describe("laneExitObligations — one exhaustive table over LaneExitKind", () => {
  it("has exactly one well-formed row per kind (a kind with no row fails here)", () => {
    expect(Object.keys(laneExitObligations).sort()).toEqual([...LANE_EXIT_KINDS].sort());
    for (const kind of LANE_EXIT_KINDS) {
      const row = laneExitObligations[kind];
      expect(row, `no obligations row for "${kind}"`).toBeDefined();
      expect(typeof row.release).toBe("boolean");
      expect(typeof row.settlePlan).toBe("boolean");
      expect(typeof row.progressed).toBe("boolean");
      expect(["done", "void", "error"]).toContain(row.phase);
      expect([0, "landed", null]).toContain(row.commits);
    }
  });

  it("states the rows the lane used to decide by hand", () => {
    expect(laneExitObligations.void).toMatchObject({ release: true, settlePlan: true, phase: "void", progressed: false });
    expect(laneExitObligations.deferred).toMatchObject({ release: false, settlePlan: false, phase: "done", progressed: true });
    expect(laneExitObligations["fence-held"]).toMatchObject({ release: true, settlePlan: false, phase: "done", commits: 0 });
    expect(laneExitObligations.failed).toMatchObject({ release: true, settlePlan: true, phase: "error" });
  });
});

describe("exitLane — the door", () => {
  it("flushes the tail, releases, settles the plan, logs, then writes ONE terminal row", async () => {
    const settlePlan = vi.fn(async () => {
      order.push("settle");
    });
    const ctx = createLaneExitContext("lane-1", settlePlan);
    ctx.claimedIds = ["a", "b"];
    ctx.planId = "plan-1";
    ctx.activity = { flush: vi.fn(async () => void order.push("flush")) };
    const res = await exitLane(ctx, "failed", { why: "it broke", error: "boom", stage: "plan", log: "boom" });
    expect(order).toEqual(["flush", "release", "settle", "log", "row"]);
    expect(released).toEqual([{ ids: ["a", "b"], why: "it broke" }]);
    expect(settlePlan).toHaveBeenCalledWith("plan-1");
    expect(patches).toEqual([{ phase: "error", error: "boom", stage: "plan", endedAt: expect.any(Date) }]);
    expect(res).toEqual({ laneId: "lane-1", progressed: false, commits: 0, closed: 0, error: "boom" });
    expect(ctx.claimedIds).toEqual([]);
  });

  it("a deferred exit TRANSFERS the claim: nothing released, nothing settled, the entry rides out", async () => {
    const settlePlan = vi.fn(async () => {});
    const ctx = createLaneExitContext("lane-1", settlePlan);
    ctx.claimedIds = ["a"];
    const deferred = { laneId: "lane-1" } as never;
    const res = await exitLane(ctx, "deferred", { commits: 2, deferred });
    expect(released).toEqual([]);
    expect(settlePlan).not.toHaveBeenCalled();
    expect(ctx.claimedIds).toEqual([]);
    expect(patches).toEqual([{ phase: "done", commits: 2, stage: null, endedAt: expect.any(Date) }]);
    expect(res).toMatchObject({ progressed: true, commits: 2, deferred });
  });

  it("a zeroed kind writes commits: 0 on the row and the result, whatever landed", async () => {
    const res = await exitLane(createLaneExitContext("lane-1", async () => {}), "fence-held", { commits: 3 });
    expect(patches[0]).toMatchObject({ phase: "done", commits: 0, stage: null });
    expect(res.commits).toBe(0);
  });

  it("an early kind leaves the row's commit count alone", async () => {
    await exitLane(createLaneExitContext("lane-1", async () => {}), "dry");
    expect(patches).toEqual([{ phase: "done", stage: null, endedAt: expect.any(Date) }]);
  });
});

// ── THE SOURCE GUARD ────────────────────────────────────────────────────────────────────────────

/** Blank comments and the TEXT of string/template literals; keep template `${…}` code. A matcher that
 *  reads raw text is satisfied by prose (see AGENTS.md, 2026-09-04). */
function stripCommentsAndStrings(src: string): string {
  let i = 0;
  const template = (): string => {
    let out = "";
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        i += 1;
        return out;
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        out += "${" + code(true) + "}";
        continue;
      }
      i += 1;
    }
    return out;
  };
  const code = (inExpr: boolean): string => {
    let out = "";
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      const n = src[i + 1];
      if (c === "/" && n === "/") {
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
      }
      if (c === "/" && n === "*") {
        const end = src.indexOf("*/", i + 2);
        i = end < 0 ? src.length : end + 2;
        out += " ";
        continue;
      }
      if (c === '"' || c === "'") {
        i += 1;
        while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
        i += 1;
        out += c + c;
        continue;
      }
      if (c === "`") {
        i += 1;
        out += "`" + template() + "`";
        continue;
      }
      if (inExpr && c === "{") depth += 1;
      if (inExpr && c === "}") {
        if (depth === 0) {
          i += 1;
          return out;
        }
        depth -= 1;
      }
      out += c;
      i += 1;
    }
    return out;
  };
  return code(false);
}

/** The balanced argument list of every `updateLane(` call in (stripped) code. */
function updateLaneArgs(code: string): string[] {
  const out: string[] = [];
  const re = /\bupdateLane\s*\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    while (j < code.length && depth > 0) {
      if (code[j] === "(") depth += 1;
      else if (code[j] === ")") depth -= 1;
      j += 1;
    }
    out.push(code.slice(start, j - 1));
  }
  return out;
}

/**
 * The hand-rolled exits a lane module may not contain. A TERMINAL row write is recognised by
 * `endedAt`: string text is blanked, so a phase VALUE is unreadable here, and every terminal write
 * stamps `endedAt` while no in-flight write does.
 */
function handRolledExits(src: string): string[] {
  const code = stripCommentsAndStrings(src);
  const found: string[] = [];
  if (/\breleaseClaims\b/.test(code)) found.push("releaseClaims");
  if (/\breleaseFollowups\s*\(/.test(code)) found.push("releaseFollowups(");
  if (/\bsettlePlan\s*\(/.test(code)) found.push("settlePlan(");
  for (const args of updateLaneArgs(code)) if (/\bendedAt\b/.test(args)) found.push(`updateLane(${args.trim().slice(0, 60)})`);
  return found;
}

describe("every exit goes through the door", () => {
  it("loop-lane.ts holds no hand-rolled release, plan settle or terminal row write", () => {
    const src = readFileSync(join(__dirname, "loop-lane.ts"), "utf8");
    expect(handRolledExits(src)).toEqual([]);
    // …and the matcher is reading the real module, not an empty string: the door IS called there.
    expect((stripCommentsAndStrings(src).match(/\bexitLane\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("guard: a seeded violation still bites (each of the four shapes)", () => {
    const seeded = [
      "async function x() {",
      "  await releaseClaims(`why ${cycle}`);",
      "  await releaseFollowups(ids, 'why', ACTOR);",
      "  await deps.settlePlan(planId);",
      '  await updateLane(laneId, { phase: "done", stage: null, endedAt: new Date() });',
      "}",
    ].join("\n");
    expect(handRolledExits(seeded)).toHaveLength(4);
  });

  it("guard: prose and string text that NAME the calls do not satisfy or trip the matcher", () => {
    const prose = [
      "// await releaseClaims(why); deps.settlePlan(planId);",
      "/* updateLane(laneId, { phase: 'done', endedAt: new Date() }) */",
      'const s = "releaseFollowups(ids) settlePlan(x) updateLane(id, { endedAt })";',
      "const t = `releaseClaims ${n > 0 ? `nested settlePlan(${n})` : ''} updateLane(a, { endedAt })`;",
      "await updateLane(laneId, { phase: \"rescanning\", commits });",
    ].join("\n");
    expect(handRolledExits(prose)).toEqual([]);
  });
});
