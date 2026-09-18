// The constellation's words: every repo the runner knows, its state in words (why it is paused, when
// it wakes), and a miniature of its map when the big panels do not already show it.

import { describe, expect, it } from "vitest";
import type { RepoRunnerState } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixtureRunner } from "../../theaterFixture";
import { foldPulse } from "./heatFold";
import { fleetStars } from "./heatFleet";
import { EMPTY_HEAT } from "./heatTypes";

const T = DEMO_EPOCH;
const repoState = (repo: string, o: Partial<RepoRunnerState> = {}): RepoRunnerState => ({
  repo,
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

describe("fleet stars", () => {
  const pulse = fixturePulse({
    lanes: [fixtureLane({ repo: "acme/kp", phase: "agent-editing" }), fixtureLane({ laneId: "q", repo: "acme/q", phase: "queued" })],
    waiting: ["acme/web"],
    runner: fixtureRunner({
      repos: [
        repoState("acme/kp", { aheadOfBase: 3 }),
        repoState("acme/broken", { paused: "repo-failures", failureStreak: 3 }),
        repoState("acme/conflict", { paused: "branch-conflict" }),
        repoState("acme/dry", { paused: "dry-backoff", pausedUntil: new Date(T + 40 * 60_000).toISOString() }),
      ],
    }),
  });

  it("orders working, queued, waiting, paused, resting — each in words", () => {
    const stars = fleetStars(pulse, EMPTY_HEAT, T, new Set(["acme/kp"]));
    expect(stars.map((s) => [s.name, s.state])).toEqual([
      ["kp", "working"],
      ["q", "queued"],
      ["web", "waiting"],
      ["broken", "paused"],
      ["conflict", "paused"],
      ["dry", "resting"],
    ]);
    expect(stars.find((s) => s.name === "kp")).toMatchObject({ words: "editing", ahead: 3 });
    expect(stars.find((s) => s.name === "broken")?.words).toBe("paused · 3 failures in a row");
    expect(stars.find((s) => s.name === "conflict")?.words).toBe("paused · branch conflict");
    expect(stars.find((s) => s.name === "dry")?.words).toMatch(/^resting · wakes \d\d:\d\d$/);
  });

  it("a repo with a map that is not on the big panels carries its miniature; one on a panel does not", () => {
    const acc = foldPulse(EMPTY_HEAT, fixturePulse({ lanes: [fixtureLane()] }), T);
    const onPanel = fleetStars(fixturePulse({ lanes: [] }), acc, T, new Set(["acme/kp"]));
    const offPanel = fleetStars(fixturePulse({ lanes: [] }), acc, T + 60_000, new Set());
    expect(onPanel.find((s) => s.repo === "acme/kp")?.map).toBeNull();
    expect(offPanel.find((s) => s.repo === "acme/kp")).toMatchObject({ state: "seen", words: expect.stringMatching(/^last touch \d+ [smhd] ago$/) });
    expect(offPanel.find((s) => s.repo === "acme/kp")?.map?.files.length).toBeGreaterThan(0);
  });
});
