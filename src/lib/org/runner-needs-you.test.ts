// How the notifier reads and announces what waits on a person: the plan title, the item identities, the
// summary sentence, the dedup + batching decision and the defensive parse. (The server-side assembly is
// pinned beside its route, in needs-you/buildNeedsYou.test.ts.)

import { describe, expect, it } from "vitest";
import type { LoopPlanRecord } from "@/lib/local/runner-types";
import { decideNotify, ledgerHref, needsYouItems, parseNeedsYou, planTitle, summarizeNeedsYou } from "./runner-needs-you";

const plan = (o: Partial<LoopPlanRecord> = {}): LoopPlanRecord => ({
  id: "plan-1", orgId: "o", repo: "acme/web", runId: null, laneId: null, directionId: null, itemKeys: [], recIds: [], itemTitles: [],
  plan: { v: 1, intent: "Split the api module", items: [], modules: [], check: "", risks: [], notDoing: [] },
  planText: "", partition: null, cls: "major", clsReason: "declared-moves", status: "pending", sessionId: null, heldBranch: null,
  decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-09-18T10:00:00Z", updatedAt: "2026-09-18T10:00:00Z", ...o,
});

describe("planTitle", () => {
  it("falls back to the first item's title, its approach, the plan text, then plain words — bounded", () => {
    expect(planTitle(plan({ plan: null, itemTitles: ["Add a coverage gate"] }))).toBe("Add a coverage gate");
    expect(planTitle(plan({ plan: { v: 1, intent: " ", items: [{ recommendationId: "r", approach: "Move the parser", files: [], moves: [] }], modules: [], check: "", risks: [], notDoing: [] } }))).toBe("Move the parser");
    expect(planTitle(plan({ plan: null, planText: "First line\nsecond" }))).toBe("First line");
    expect(planTitle(plan({ plan: null, planText: "" }))).toBe("A plan waits for review");
    expect(planTitle(plan({ plan: null, planText: "x".repeat(300) })).length).toBe(120);
  });
});

describe("items and the summary", () => {
  const res = {
    plans: [plan(), plan({ id: "plan-2" })].map((p) => ({ id: p.id, repo: p.repo, title: planTitle(p), createdAt: p.createdAt })),
    pausedRepos: [{ repo: "acme/kp", reason: "branch-conflict" as const, note: null }],
    runnerPaused: null,
  };

  it("each waiting thing has a stable id", () => {
    expect(needsYouItems(res).map((i) => i.id)).toEqual(["plan:plan-1", "plan:plan-2", "repo:acme/kp:branch-conflict"]);
  });

  it("summarises in one sentence", () => {
    expect(summarizeNeedsYou(needsYouItems(res))).toBe("2 directions wait for your approval · kp paused: branch conflict");
    expect(summarizeNeedsYou(needsYouItems({ plans: [], pausedRepos: [], runnerPaused: { reason: "session-limit", until: null } }))).toBe("Runner paused: session limit");
  });

  it("the ledger link", () => {
    expect(ledgerHref("acme")).toBe("/org/acme?tab=live&view=ledger");
  });
});

describe("decideNotify — dedup per item, one notification per batch window", () => {
  const items = (...ids: string[]) => ids.map((id) => ({ id, kind: "plan" as const, repo: "acme/web", reason: null }));
  const WINDOW = 900_000;

  it("announces what is new, then stays quiet about it", () => {
    const a = decideNotify({ seen: [], lastAt: null }, items("plan:1"), 0, WINDOW);
    expect(a.notify?.map((i) => i.id)).toEqual(["plan:1"]);
    expect(decideNotify(a.state, items("plan:1"), WINDOW * 2, WINDOW).notify).toBeNull();
  });

  it("holds new items inside the window and announces them together when it opens", () => {
    const a = decideNotify({ seen: [], lastAt: null }, items("plan:1"), 0, WINDOW);
    const b = decideNotify(a.state, items("plan:1", "plan:2"), 60_000, WINDOW);
    expect(b.notify).toBeNull();
    const c = decideNotify(b.state, items("plan:1", "plan:2", "plan:3"), 120_000, WINDOW);
    expect(c.notify).toBeNull();
    const d = decideNotify(c.state, items("plan:1", "plan:2", "plan:3"), WINDOW, WINDOW);
    expect(d.notify?.map((i) => i.id)).toEqual(["plan:2", "plan:3"]);
  });

  it("forgets what cleared, so the same thing recurring later is news again", () => {
    const a = decideNotify({ seen: [], lastAt: null }, items("repo:kp:branch-conflict"), 0, WINDOW);
    const cleared = decideNotify(a.state, [], WINDOW, WINDOW);
    expect(cleared.state.seen).toEqual([]);
    expect(decideNotify(cleared.state, items("repo:kp:branch-conflict"), WINDOW * 2, WINDOW).notify).toHaveLength(1);
  });
});

describe("parseNeedsYou", () => {
  it("reads the route's answer and refuses what is not one", () => {
    expect(parseNeedsYou({ runner: true, plans: [{ id: "p", repo: "r", title: "t", createdAt: "c" }], pausedRepos: [], runnerPaused: null })?.plans).toHaveLength(1);
    expect(parseNeedsYou({ error: "nope" })).toBeNull();
    expect(parseNeedsYou("<html>")).toBeNull();
    expect(parseNeedsYou({ runner: false, plans: [{ bogus: 1 }] })).toEqual({ runner: false, plans: [], pausedRepos: [], runnerPaused: null });
  });
});
