// THE CYCLE, end to end, with no database, no network and no Next.js.
//
// Every dependency is injected, so the four rules in `cycle.ts`'s header are assertable as behaviour
// rather than as prose: what is spent, when nothing is spent, what lands, and what she remembers.
//
// The last test in this file is a SOURCE-LEVEL assertion rather than a behavioural one, and it is
// deliberate: "the cycle never writes AthenaIdentity" is a claim about a path that must not exist at
// all, and a behavioural test can only prove that the paths it happened to exercise did not take it.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runOrgCycle, isLiveTurn, ATHENA_LIVE_TURN_WINDOW_MS, type CycleLandInput, type OrgCycleDeps } from "./cycle";
import { CYCLE_SILENCE_TOKEN, type CycleStanding } from "./cycle-prompt";
import type { AthenaLoopRun } from "./turn";

const NOW = new Date("2026-08-25T07:30:00.000Z");

const standing = (over: Partial<CycleStanding> = {}): CycleStanding => ({
  repoCount: 14,
  scannedCount: 12,
  avgOverall: 62,
  level: "Practicing",
  overallDelta: 0,
  cohortSize: 12,
  movers: [],
  ...over,
});

const run = (text: string): AthenaLoopRun => ({
  text,
  usage: { inputTokens: 900, outputTokens: 120 },
  legs: 1,
  toolCalls: [],
  truncated: false,
  grounding: "prefetched",
  engine: "openai",
  model: "gpt-test",
});

interface Harness {
  deps: OrgCycleDeps;
  landed: CycleLandInput[];
  episodes: { content: string; tags: string[] }[];
  prompts: string[];
}

function harness(over: Partial<OrgCycleDeps> & { completion?: string } = {}): Harness {
  const landed: CycleLandInput[] = [];
  const episodes: { content: string; tags: string[] }[] = [];
  const prompts: string[] = [];
  const { completion, ...depOver } = over;
  const deps: OrgCycleDeps = {
    landing: async () => ({ threadId: "th_1", lastRole: "assistant", lastAt: "2026-08-20T10:00:00.000Z" }),
    standing: async () => standing(),
    openProposals: async () => [],
    identity: async () => ({ constitution: "Be exact.", selfModel: null }),
    runLoop: async (req) => {
      prompts.push(req.prompt);
      return run(completion ?? "The fleet held steady.");
    },
    land: async (input) => {
      landed.push(input);
      return { threadId: input.threadId ?? "th_new", turnId: "tu_1" };
    },
    writeEpisode: async (input) => {
      episodes.push({ content: input.content, tags: input.tags });
      return { id: "mem_1" };
    },
    now: () => NOW,
    ...depOver,
  };
  return { deps, landed, episodes, prompts };
}

describe("a completion is never spent when there is nowhere to land it", () => {
  it("skips an org with no reachable store, without calling the model", async () => {
    const runLoop = vi.fn();
    const h = harness({ landing: async () => null, runLoop });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.skipped).toBe("no_landing");
    expect(runLoop).not.toHaveBeenCalled();
    expect(h.landed).toHaveLength(0);
    expect(h.episodes).toHaveLength(0);
    expect(result.claimHeld).toBe(false);
  });

  it("skips an org with no standing to brief on, without calling the model", async () => {
    const runLoop = vi.fn();
    const h = harness({ standing: async () => null, runLoop });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.skipped).toBe("no_standing");
    expect(runLoop).not.toHaveBeenCalled();
  });

  it("writes no episode and holds no claim when there is no engine", async () => {
    const h = harness({ runLoop: async () => null });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.skipped).toBe("no_engine");
    expect(h.episodes).toHaveLength(0);
    expect(result.claimHeld).toBe(false);
  });
});

describe("a cycle never races a live turn, and never queues behind one", () => {
  it("skips an org whose newest turn is an unanswered question from moments ago", async () => {
    const runLoop = vi.fn();
    const h = harness({
      landing: async () => ({
        threadId: "th_1",
        lastRole: "user",
        lastAt: new Date(NOW.getTime() - 5_000).toISOString(),
      }),
      runLoop,
    });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.skipped).toBe("live_turn");
    expect(runLoop).not.toHaveBeenCalled();
    // Skipped, NOT queued: nothing was recorded to be picked up later.
    expect(h.landed).toHaveLength(0);
  });

  it("does not treat an old unanswered question as a permanent do-not-disturb", () => {
    const stale = new Date(NOW.getTime() - ATHENA_LIVE_TURN_WINDOW_MS - 1_000).toISOString();
    expect(isLiveTurn({ threadId: "t", lastRole: "user", lastAt: stale }, NOW)).toBe(false);
    const fresh = new Date(NOW.getTime() - 1_000).toISOString();
    expect(isLiveTurn({ threadId: "t", lastRole: "user", lastAt: fresh }, NOW)).toBe(true);
    // Her own last word is not an exchange in progress.
    expect(isLiveTurn({ threadId: "t", lastRole: "assistant", lastAt: fresh }, NOW)).toBe(false);
    expect(isLiveTurn({ threadId: "t", lastRole: null, lastAt: null }, NOW)).toBe(false);
  });
});

describe("report-or-absorb decides contact", () => {
  it("absorbs a flat briefing: nothing lands, and the run is still recorded", async () => {
    const h = harness({ completion: "The fleet held steady at 62 of 100 across 12 repositories." });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.landed).toBe(false);
    expect(h.landed).toHaveLength(0);
    expect(result.absorbed).toBe(1);
    expect(result.absorbedBy).toEqual({ within_noise: 1 });
    // Recorded, countable, inspectable — and it initiated nothing.
    expect(h.episodes).toHaveLength(1);
    expect(h.episodes[0]!.tags).toContain("absorbed");
    // The claim is HELD: the work was done and the answer was "nothing to say".
    expect(result.claimHeld).toBe(true);
  });

  it("lands a briefing when the standing moved beyond the noise band", async () => {
    const h = harness({
      standing: async () => standing({ overallDelta: -7 }),
      completion: "D9 slid 7 points across the fleet after last week's CI change.",
    });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.landed).toBe(true);
    expect(h.landed[0]!.content).toContain("D9 slid 7 points");
    expect(h.landed[0]!.threadId).toBe("th_1");
    expect(h.landed[0]!.meta).toMatchObject({ cycle: true, engine: "openai", raised: 1 });
  });

  it("treats her declared silence as silence, and discards any offer attached to it", async () => {
    const h = harness({
      completion: `${CYCLE_SILENCE_TOKEN}\n\n\`\`\`athena:action\n{"action":"rule_on_finding","params":{"module":"security","itemKey":"a::b","ruling":"dismissed","rationale":"why"}}\n\`\`\``,
    });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.landed).toBe(false);
    expect(result.proposals).toBe(0);
    expect(h.landed).toHaveLength(0);
  });

  it("raises a proposal with the prose that explains it, in one land call", async () => {
    const h = harness({
      completion:
        "Two follow-ups have been open for a fortnight.\n\n```athena:action\n{\"action\":\"handoff_followups\",\"params\":{\"ids\":[\"f1\",\"f2\"]}}\n```",
    });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.landed).toBe(true);
    expect(result.proposals).toBe(1);
    expect(h.landed).toHaveLength(1);
    // The card and the conversation above it are written together — see appendAthenaTurn's transaction.
    expect(h.landed[0]!.proposals).toEqual([
      { kind: "handoff_followups", payload: { params: { ids: ["f1", "f2"] } } },
    ]);
    expect(h.landed[0]!.content).toContain("Two follow-ups");
  });
});

describe("she writes ONE episode, and it is hers", () => {
  it("writes exactly one, on a landed run and on an absorbed one alike", async () => {
    const landedRun = harness({
      standing: async () => standing({ overallDelta: 9 }),
      completion: "The fleet climbed 9 points, led by acme/api.",
    });
    await runOrgCycle({ orgSlug: "acme", deps: landedRun.deps });
    expect(landedRun.episodes).toHaveLength(1);

    const quiet = harness();
    await runOrgCycle({ orgSlug: "acme", deps: quiet.deps });
    expect(quiet.episodes).toHaveLength(1);
  });

  it("has no dependency that could write a user episode", () => {
    // `writeEpisode` takes content + tags only — there is no role on it, and `writeAthenaEpisode`
    // stamps `source: "athena"` / `createdBy: null` unconditionally (athena-episodes.ts). Putting
    // words in the operator's mouth is not a mistake this seam can make.
    const h = harness();
    expect(Object.keys(h.deps)).not.toContain("writeUserEpisode");
  });
});

describe("titles stay derived, never typed", () => {
  it("mints a thread titled from the briefing's own first line", async () => {
    const h = harness({
      landing: async () => ({ threadId: null, lastRole: null, lastAt: null }),
      standing: async () => standing({ overallDelta: -8 }),
      completion: "Security posture slid 8 points this week.\n\nThe cause is acme/api.",
    });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.landed).toBe(true);
    expect(h.landed[0]!.threadId).toBeNull(); // the store mints it
    expect(h.landed[0]!.title).toBe("Security posture slid 8 points this week.");
  });

  it("reports claimHeld:false when the land wrote nothing", async () => {
    const h = harness({
      standing: async () => standing({ overallDelta: -8 }),
      completion: "Security posture slid 8 points this week.",
      land: async () => null,
    });
    const result = await runOrgCycle({ orgSlug: "acme", deps: h.deps });
    expect(result.landed).toBe(false);
    expect(result.claimHeld).toBe(false);
  });
});

describe("no unattended path mutates who she is", () => {
  const root = join(process.cwd(), "src");
  const sources = [
    join(root, "lib", "athena", "cycle.ts"),
    join(root, "lib", "athena", "cycle-signal.ts"),
    join(root, "lib", "athena", "cycle-prompt.ts"),
    join(root, "app", "api", "cron", "athena", "route.ts"),
    join(root, "app", "api", "cron", "athena", "deps.ts"),
  ];

  it("no module in the cycle imports an AthenaIdentity writer", () => {
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      // The self-model writer, the seeder, and the Prisma model itself. `athena-identity` is readable
      // (getAthenaIdentityPair) but nothing here may reach a write.
      expect(src, `${file} must not write identity`).not.toMatch(/\bupdateSelfModel\b/);
      expect(src, `${file} must not seed identity`).not.toMatch(/\bseedAthenaIdentity\b/);
      expect(src, `${file} must not touch the model directly`).not.toMatch(/athenaIdentity\s*\./);
    }
  });

  it("OrgCycleDeps offers no identity-writing seam", () => {
    const h = harness();
    const keys = Object.keys(h.deps);
    expect(keys).not.toContain("updateSelfModel");
    expect(keys).not.toContain("writeIdentity");
    expect(keys).toContain("identity"); // read-only: it returns two strings
  });
});
