import { describe, expect, it } from "vitest";
import { plan, repoState, runnerDrive } from "../ledger/ledgerFixture";
import { deskData, lesson } from "./deskFixture";
import { deriveWaiting, LESSONS_READ } from "./waitingModel";

const seqOf = (id: string) => Number(id.replace("run-", "")) || null;

describe("deriveWaiting", () => {
  it("ranks needs-you first and opens a card only where something waits", () => {
    const data = deskData();
    data.ledger.pending = [plan("p1"), plan("p2", { repo: "acme/web" })];
    data.ledger.runner = runnerDrive({ repoState: [repoState("acme/web", { paused: "branch-conflict", note: "src/a.ts conflicts" })] });
    const w = deriveWaiting(data, null, seqOf);
    expect(w.cards.map((c) => c.key)).toEqual(["plans", "paused", "merge", "rejected", "lessons"]);
    expect(w.cards[0]).toMatchObject({ n: 2, sub: "kp 1 · web 1", src: "records", live: false });
    expect(w.cards[1]).toMatchObject({ n: 1, sub: "web branch conflict" });
    expect(w.open).toBe(5);
  });

  it("keeps unknown commits-ahead unknown instead of adding them as zero", () => {
    const w = deriveWaiting(deskData(), null, seqOf);
    const merge = w.cards.find((c) => c.key === "merge")!;
    expect(merge.n).toBe(3);
    expect(merge.sub).toBe("kp 3 · web ?");
    const onlyUnknown = deskData();
    onlyUnknown.ledger.ahead = { "acme/kp": null };
    expect(deriveWaiting(onlyUnknown, null, seqOf).cards.find((c) => c.key === "merge")).toMatchObject({ n: "?", title: "Merge state unknown" });
  });

  it("shows a calm plan card when the inbox is clear, and a live one when the fresh pulse knows of a plan", () => {
    expect(deriveWaiting(deskData(), null, seqOf).cards[0]).toMatchObject({ key: "plans", calm: true, n: 0 });
    expect(deriveWaiting(deskData(), 1, seqOf).cards[0]).toMatchObject({ key: "plans", calm: false, live: true, n: 1, src: "live" });
  });

  it("says a failed read out loud", () => {
    const data = deskData({ pendingLessons: null });
    data.ledger.pending = null;
    const w = deriveWaiting(data, null, seqOf);
    expect(w.cards.find((c) => c.key === "plans")).toMatchObject({ n: "?", title: "Could not read the plans" });
    expect(w.cards.find((c) => c.key === "lessons")).toMatchObject({ n: "?", title: "Could not read the lessons" });
  });

  it("names the rejected rounds and marks a full lesson read as a lower bound", () => {
    const data = deskData({ pendingLessons: Array.from({ length: LESSONS_READ }, (_, i) => lesson(`x${i}`)) });
    const w = deriveWaiting(data, null, seqOf);
    expect(w.cards.find((c) => c.key === "rejected")).toMatchObject({ n: 1, sub: "rounds #4" });
    expect(w.cards.find((c) => c.key === "lessons")!.n).toBe(`${LESSONS_READ}+`);
  });

  it("finds a plan still executing after its run ended, but not the active run's", () => {
    const data = deskData();
    data.ledger.plans = [plan("s1", { status: "executing", runId: "run-4", laneId: "l5" }), plan("s2", { status: "executing", runId: "run-9", laneId: null })];
    const w = deriveWaiting(data, null, seqOf);
    expect(w.stale.map((s) => s.plan.id)).toEqual(["s1"]);
    expect(w.cards.find((c) => c.key === "stale-plan")!.sub).toBe("kp · run #4 ended");
    data.ledger.activeRun = { id: "run-4", seq: 4, cycle: 1, maxCycles: 1, startedAt: data.ledger.now };
    expect(deriveWaiting(data, null, seqOf).stale).toEqual([]);
  });
});
