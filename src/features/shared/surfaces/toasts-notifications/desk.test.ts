// The desk's store under node: the queue's policy (coalescing, cooldown, preemption, the summarized
// tail, attention pausing the clock), the undo window committing on expiry, the stale retry, one
// identity across tiers, the derived badge, obligations surviving bulk read and the reaper, the
// send-time decision, and the announcer's serial drain with assertive jumping the queue.

import { describe, expect, it } from "vitest";
import { type Action, type DeskState, initialDesk, reduce } from "./desk";
import { EVENTS, UNDO_WINDOW_MS, fleetFor, semanticKey, storm } from "./fixtures";
import { badge, sections } from "./ledger";
import { MAX_VISIBLE, visible, waiting } from "./queue";

const FLEET = fleetFor(50);
const run = (...actions: Action[]) => actions.reduce(reduce, initialDesk(FLEET));
const tickTo = (s: DeskState, ms: number) => reduce(s, { type: "tick", dt: ms });
const emit = (ev: Parameters<typeof EVENTS.scanFinished>[0] extends string ? ReturnType<(typeof EVENTS)[keyof typeof EVENTS]> : never): Action => ({ type: "emit", ev });

describe("queue discipline", () => {
  it("coalesces a live repeat into one toast with a count, and suppresses a repeat inside the cooldown", () => {
    let s = run(emit(EVENTS.rescanFailed("a")), emit(EVENTS.rescanFailed("a")), emit(EVENTS.rescanFailed("a")));
    expect(s.queue.toasts).toHaveLength(1);
    expect(s.queue.toasts[0].count).toBe(3);
    expect(s.queue.stats.coalesced).toBe(2);
    s = reduce(s, { type: "dismiss", id: s.queue.toasts[0].id });
    s = reduce(s, emit(EVENTS.rescanFailed("a")));
    expect(s.queue.toasts).toHaveLength(0);
    expect(s.queue.stats.suppressed).toBe(1);
    // The record still counted it: one fact, four occurrences.
    expect(s.ledger.find((e) => e.key === semanticKey(EVENTS.rescanFailed("a")))?.count).toBe(4);
  });

  it("holds MAX_VISIBLE, lets a critical preempt the lowest slot, and summarizes the tail", () => {
    let s = run(emit(EVENTS.scanFinished("a")), emit(EVENTS.scanFinished("b")), emit(EVENTS.scanFinished("c")), emit(EVENTS.peerJoined("p")));
    expect(visible(s.queue)).toHaveLength(MAX_VISIBLE);
    expect(waiting(s.queue).map((t) => t.kind)).toEqual(["peer-joined"]);
    s = reduce(s, emit(EVENTS.engineDown()));
    expect(visible(s.queue).some((t) => t.severity === "critical")).toBe(true);
    expect(visible(s.queue).filter((t) => t.severity === "success")).toHaveLength(2);
    storm(FLEET).forEach((ev) => (s = reduce(s, emit(ev))));
    const tail = waiting(s.queue);
    expect(tail.length).toBeLessThanOrEqual(3);
    expect(tail.at(-1)?.kind).toBe("summary");
    expect(s.queue.stats.shed).toBeGreaterThan(0);
    expect(s.ledger.filter((e) => e.kind === "rescan-failed")).toHaveLength(FLEET.length + 2); // shed reached the record
  });

  it("dwell runs only for visible, unattended toasts and leaving grants a fresh allowance", () => {
    let s = run(emit(EVENTS.scanFinished("a")));
    const id = s.queue.toasts[0].id;
    s = tickTo(s, 1000);
    expect(s.queue.toasts[0].remainingMs).toBe(s.queue.toasts[0].dwellMs! - 1000);
    s = reduce(s, { type: "attend", id, on: true });
    s = tickTo(s, 5000);
    expect(s.queue.toasts).toHaveLength(1);
    s = reduce(s, { type: "attend", id, on: false });
    expect(s.queue.toasts[0].remainingMs).toBe(s.queue.toasts[0].dwellMs);
    s = tickTo(s, 10_000);
    expect(s.queue.toasts).toHaveLength(0);
  });

  it("an obligation never auto-dismisses; dismissing it defers, the ledger keeps it unread", () => {
    let s = run(emit(EVENTS.credentialExpired()));
    s = tickTo(s, 60_000);
    expect(s.queue.toasts).toHaveLength(1);
    s = reduce(s, { type: "dismiss", id: s.queue.toasts[0].id });
    const e = s.ledger[0];
    expect(e.actionRequired && !e.resolved && !e.read).toBe(true);
  });
});

describe("actionable toasts", () => {
  it("undo restores; expiry commits the deferred removal", () => {
    let s = run({ type: "fleet:unwatch", name: FLEET[0] });
    expect(s.fleet[0].status).toBe("pending-removal");
    expect(s.queue.toasts[0].dwellMs).toBe(UNDO_WINDOW_MS);
    const undone = reduce(s, { type: "act", id: s.queue.toasts[0].id });
    expect(undone.fleet[0].status).toBe("watched");
    s = tickTo(s, UNDO_WINDOW_MS + 100);
    expect(s.fleet[0].status).toBe("removed");
  });

  it("a stale retry degrades to a quiet acknowledgment, never a second failure", () => {
    let s = run({ type: "rescan:fail", name: "x" }, { type: "rescan:recover", name: "x" });
    const retry = s.queue.toasts.find((t) => t.verb === "Retry")!;
    s = reduce(s, { type: "act", id: retry.id });
    expect(s.queue.toasts.some((t) => t.verb === "Retry")).toBe(false);
    expect(s.queue.toasts.filter((t) => t.severity === "error")).toHaveLength(0);
    expect(s.queue.toasts.some((t) => t.title.startsWith("Nothing to retry"))).toBe(true);
  });
});

describe("durable ledger", () => {
  it("one identity: acting on the toast resolves the entry and withdraws the OS note", () => {
    let s = run({ type: "os:request", grant: true }, { type: "os:set", patch: { foregrounded: false } }, emit(EVENTS.regression("a")));
    const t = s.queue.toasts[0];
    expect(s.ledger[0].id).toBe(t.id);
    expect(s.os.outbox[0].status).toBe("sent");
    s = reduce(s, { type: "act", id: t.id });
    expect(s.ledger[0].resolved).toBe(true);
    expect(s.os.outbox[0].status).toBe("withdrawn");
    expect(s.queue.toasts).toHaveLength(0);
  });

  it("the badge is derived under one predicate; mark-all-read zeroes it but keeps the obligation", () => {
    let s = run(emit(EVENTS.credentialExpired()), emit(EVENTS.creditsLow()), emit(EVENTS.peerJoined("p")));
    expect(s.ledger).toHaveLength(2); // info without awaited earns no record
    expect(badge(s.ledger)).toEqual({ predicate: "unread", count: 2 });
    s = reduce(s, { type: "ledger:read-all" });
    expect(badge(s.ledger).count).toBe(0);
    expect(sections(s.ledger).obligations).toHaveLength(1);
  });

  it("the reaper removes read news, then unread news, and never an open obligation", () => {
    let s = run(emit(EVENTS.credentialExpired()), emit(EVENTS.creditsLow()), emit(EVENTS.scanFinished("a")));
    s = reduce(s, { type: "ledger:read", id: s.ledger.find((e) => e.kind === "scan-finished")!.id });
    s = tickTo(s, 25_000);
    expect(s.ledger.map((e) => e.kind).sort()).toEqual(["credential-expired", "credits-low"]);
    s = tickTo(s, 40_000);
    expect(s.ledger.map((e) => e.kind)).toEqual(["credential-expired"]);
    expect(s.reaped).toBe(2);
  });
});

describe("os escalation and announcement", () => {
  it("never notifies about the visible surface; denial is stated; a refused send keeps the record", () => {
    let s = run({ type: "os:request", grant: true }, emit(EVENTS.scanFinished("a")));
    expect(s.os.outbox).toHaveLength(0); // looking at scans
    expect(s.log[0]).toMatch(/looking at scans/);
    s = reduce(s, { type: "os:set", patch: { visibleSurface: "billing" } });
    s = reduce(s, emit(EVENTS.scanFinished("b")));
    expect(s.os.outbox).toHaveLength(1);
    s = reduce(s, { type: "os:set", patch: { platformUp: false } });
    s = reduce(s, emit(EVENTS.regression("c")));
    expect(s.os.outbox[0].status).toBe("failed");
    expect(s.os.failures).toBe(1);
    expect(s.ledger.some((e) => e.kind === "regression")).toBe(true);
    const denied = run({ type: "os:request", grant: false }, { type: "os:set", patch: { foregrounded: false } }, emit(EVENTS.scanFinished("a")));
    expect(denied.os.outbox).toHaveLength(0);
    expect(denied.log[0]).toMatch(/permission denied/);
  });

  it("drains serially with a gap, assertive jumps the queue, and a repeat announces the update", () => {
    let s = run(emit(EVENTS.scanFinished("a")), emit(EVENTS.creditsLow()), emit(EVENTS.engineDown()));
    expect(s.announcer.queue[0].politeness).toBe("assertive");
    expect(s.announcer.assertive).toBe("");
    s = tickTo(s, 100);
    expect(s.announcer.assertive).toMatch(/engine unreachable/);
    expect(s.announcer.polite).toBe("");
    s = tickTo(s, 1400);
    expect(s.announcer.polite).toBe("");
    s = tickTo(s, 200);
    expect(s.announcer.polite).toMatch(/Scan of a finished/);
    s = reduce(s, emit(EVENTS.creditsLow()));
    expect(s.announcer.queue.filter((u) => u.key === "credits-low:ledger")).toHaveLength(1);
    expect(s.announcer.queue.find((u) => u.key === "credits-low:ledger")?.text).toMatch(/still, 2 times/);
  });
});
