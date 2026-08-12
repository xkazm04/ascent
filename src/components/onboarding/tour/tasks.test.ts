// The drawer's content model — pure, so the ordering, availability honesty, spotlight mapping and the
// entry-intensity rule are all pinned without a DOM.

import { describe, it, expect } from "vitest";
import type { GettingStartedStep, GettingStartedStepId } from "@/lib/org/getting-started";
import {
  buildDrawerItems,
  decidePosture,
  nextTask,
  shouldStampCompleted,
  taskProgress,
  type GettingStartedPayload,
} from "./tasks";

const TAB: Record<GettingStartedStepId, GettingStartedStep["tab"]> = {
  "first-scan": "overview",
  "gap-engaged": "backlog",
  registry: "skills",
  loop: "repositories",
  team: "members",
};
const PHASE: Record<GettingStartedStepId, GettingStartedStep["phase"]> = {
  "first-scan": "baseline",
  "gap-engaged": "resolve",
  registry: "registry",
  loop: "loop",
  team: "team",
};
const ANCHOR: Record<GettingStartedStepId, string> = {
  "first-scan": "results-view",
  "gap-engaged": "backlog-recs",
  registry: "skills-registry",
  loop: "watch-schedule",
  team: "invite-member",
};

function step(id: GettingStartedStepId, over: Partial<GettingStartedStep> = {}): GettingStartedStep {
  return { id, phase: PHASE[id], done: false, available: true, tab: TAB[id], anchor: ANCHOR[id], ...over };
}

function payload(over: Partial<GettingStartedPayload> = {}): GettingStartedPayload {
  return {
    steps: [step("first-scan"), step("gap-engaged"), step("registry"), step("loop"), step("team")],
    allDone: false,
    personal: false,
    onboarding: { completedAt: null, skippedAt: null, dismissed: false },
    ...over,
  };
}

describe("buildDrawerItems", () => {
  it("renders one row per server step, in the server's narrative order", () => {
    const items = buildDrawerItems(payload(), { includeTeach: false });
    expect(items.map((i) => i.taskId)).toEqual(["first-scan", "gap-engaged", "registry", "loop", "team"]);
    expect(items.every((i) => i.kind === "task")).toBe(true);
  });

  it("takes doneness and availability straight from the server — never from local state", () => {
    const items = buildDrawerItems(
      payload({ steps: [step("first-scan", { done: true }), step("team", { available: false })] }),
      { includeTeach: false },
    );
    expect(items[0]!.done).toBe(true);
    expect(items[1]!.available).toBe(false);
    // An unavailable row is rendered WITH a reason, never hidden.
    expect(items[1]!.unavailableReason).toBeTruthy();
  });

  it("spotlights the control that DOES the work while a task is undone, and its proof once done", () => {
    const undone = buildDrawerItems(payload({ steps: [step("first-scan")] }), { includeTeach: false })[0]!;
    // The results grid doesn't exist before the first scan, so point at the scan control instead.
    expect(undone.tour.anchor).toBe("scan-scope");
    expect(undone.tour.title).toBe("Set your scan scope");

    const done = buildDrawerItems(payload({ steps: [step("first-scan", { done: true })] }), {
      includeTeach: false,
    })[0]!;
    expect(done.tour.anchor).toBe("results-view");
  });

  it("uses the server's anchor + the task's own copy where no teach step is a partner", () => {
    const items = buildDrawerItems(payload({ steps: [step("gap-engaged"), step("registry"), step("team")] }), {
      includeTeach: false,
    });
    expect(items.map((i) => i.tour.anchor)).toEqual(["backlog-recs", "skills-registry", "invite-member"]);
    expect(items[0]!.tour.title).toBe(items[0]!.title);
  });

  it("appends only the UNCLAIMED teach steps, and only in the teaching posture", () => {
    const teaching = buildDrawerItems(payload(), { includeTeach: true }).filter((i) => i.kind === "teach");
    expect(teaching.map((i) => i.key)).toEqual([
      "teach:results-controls",
      "teach:modules-nav",
      "teach:modules-briefing",
    ]);
    expect(buildDrawerItems(payload(), { includeTeach: false }).some((i) => i.kind === "teach")).toBe(false);
  });

  it("degrades to the teach rail alone when there is no payload", () => {
    expect(buildDrawerItems(null, { includeTeach: true }).every((i) => i.kind === "teach")).toBe(true);
    expect(buildDrawerItems(null, { includeTeach: false })).toEqual([]);
  });
});

describe("taskProgress / nextTask", () => {
  it("counts over AVAILABLE tasks only — an unavailable step can't make progress unreachable", () => {
    const items = buildDrawerItems(
      payload({
        steps: [
          step("first-scan", { done: true }),
          step("gap-engaged", { done: true }),
          step("registry", { done: true }),
          step("loop", { available: false }),
          step("team", { available: false }),
        ],
      }),
      { includeTeach: true },
    );
    expect(taskProgress(items)).toEqual({ done: 3, total: 3 });
    expect(nextTask(items)).toBeNull(); // teach rows are never promoted as "next"
  });

  it("promotes the first available undone task in narrative order", () => {
    const items = buildDrawerItems(
      payload({ steps: [step("first-scan", { done: true }), step("gap-engaged", { available: false }), step("registry")] }),
      { includeTeach: false },
    );
    expect(nextTask(items)?.taskId).toBe("registry");
  });

  it("gives a personal workspace a shorter list rather than a mostly-disabled one", () => {
    // The server drops loop/team availability for personal; the drawer's progress follows.
    const items = buildDrawerItems(
      payload({
        personal: true,
        steps: [
          step("first-scan"),
          step("gap-engaged"),
          step("registry"),
          step("loop", { available: false }),
          step("team", { available: false }),
        ],
      }),
      { includeTeach: false },
    );
    expect(taskProgress(items).total).toBe(3);
  });
});

describe("decidePosture — entry intensity by stamp", () => {
  it("opens as the companion for an unstamped member with work left", () => {
    expect(decidePosture(payload(), { isDemoOrg: false })).toBe("companion");
  });

  it("falls back to teaching once either stamp is set", () => {
    const stamped = { completedAt: null, skippedAt: "2026-08-12T00:00:00.000Z", dismissed: true };
    expect(decidePosture(payload({ onboarding: stamped }), { isDemoOrg: false })).toBe("teaching");
  });

  it("never auto-opens for a non-member (no membership row ⇒ no stamp to own)", () => {
    expect(decidePosture(payload({ onboarding: null }), { isDemoOrg: false })).toBe("teaching");
  });

  it("never auto-opens on the demo org", () => {
    expect(decidePosture(payload(), { isDemoOrg: true })).toBe("teaching");
  });

  it("never auto-opens when everything available is already done", () => {
    expect(decidePosture(payload({ allDone: true }), { isDemoOrg: false })).toBe("teaching");
  });

  it("never auto-opens when every remaining task is out of the viewer's reach", () => {
    const p = payload({
      steps: [step("first-scan", { done: true }), step("gap-engaged", { available: false })],
    });
    expect(decidePosture(p, { isDemoOrg: false })).toBe("teaching");
  });

  it("degrades to teaching with no payload at all (a failed or DB-less read)", () => {
    expect(decidePosture(null, { isDemoOrg: false })).toBe("teaching");
  });
});

describe("shouldStampCompleted", () => {
  it("is true exactly when an unstamped member has finished every available step", () => {
    expect(shouldStampCompleted(payload({ allDone: true }))).toBe(true);
    expect(shouldStampCompleted(payload({ allDone: false }))).toBe(false);
    // Already stamped — nothing to write.
    expect(
      shouldStampCompleted(
        payload({ allDone: true, onboarding: { completedAt: "x", skippedAt: null, dismissed: true } }),
      ),
    ).toBe(false);
    // No membership row — there is no stamp to write.
    expect(shouldStampCompleted(payload({ allDone: true, onboarding: null }))).toBe(false);
    expect(shouldStampCompleted(null)).toBe(false);
  });
});
