// The card's state machine, as a pure function of the record and the last resolve answer.
//
// The cases that matter are the ones a click can get wrong: an identity diff offered an Accept the door
// refuses, a 409 re-enabling a button, and the two 500s - one retryable (the claim was released), one
// that must NEVER be retried (the action ran and its stamp threw). The second is told apart by the
// route's own sentence, pinned here verbatim so a rewording of that error fails a test.

import { describe, it, expect } from "vitest";
import { canAccept, canDecline, lifecycleOf } from "@/lib/athena/proposal-lifecycle";
import { cardStateOf, parseResolveResponse, proposalIdsOf, IDENTITY_DIFF } from "./proposalModel";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const base = { status: "open", kind: "rule_on_finding", payload: {}, resolvedAt: null, claimedAt: null };

describe("cardStateOf - what the record allows", () => {
  it("an open action ask offers both buttons", () => {
    expect(cardStateOf({ status: "open", kind: "rule_on_finding" })).toMatchObject({
      mode: "ask",
      canAccept: true,
      canDecline: true,
    });
  });

  it("an open identity_diff is decline-only (the door 409s its accept)", () => {
    expect(cardStateOf({ status: "open", kind: IDENTITY_DIFF })).toMatchObject({
      mode: "ask",
      canAccept: false,
      canDecline: true,
    });
  });

  it("reads the buttons off the shared lifecycle table, not a second list", () => {
    for (const status of ["open", "accepted", "declined", "expired", "weird"]) {
      const s = cardStateOf({ ...base, status, resolvedAt: status === "open" ? null : "2026-10-21T00:00:00Z" }, undefined, NOW);
      const life = lifecycleOf({ status, resolvedAt: status === "open" ? null : "x" }, NOW);
      expect(s.canAccept).toBe(canAccept(life));
      expect(s.canDecline).toBe(canDecline(life));
    }
  });

  it("paints a resolved record's stamped outcome after a reload", () => {
    const s = cardStateOf(
      { ...base, status: "accepted", resolvedAt: "2026-10-21T00:00:00Z", payload: { outcome: { ok: true, kind: "ruled", detail: "Ruled: dismissed." } } },
      undefined,
      NOW,
    );
    expect(s).toMatchObject({ mode: "answered", canAccept: false, canDecline: false });
    expect(s.outcome).toEqual({ detail: "Ruled: dismissed.", tone: "done" });
  });

  it("paints expired and unknown honestly, with no buttons", () => {
    const expired = cardStateOf({ ...base, status: "expired", resolvedAt: "x" }, undefined, NOW);
    expect(expired).toMatchObject({ mode: "expired", canAccept: false, canDecline: false });
    expect(expired.note).toMatch(/expired/i);
    const unknown = cardStateOf({ ...base, status: "frozen" }, undefined, NOW);
    expect(unknown).toMatchObject({ mode: "unknown", canAccept: false, canDecline: false });
    expect(unknown.note).toMatch(/cannot act on/);
  });

  it("a live claim and a stale claim are held, never offered", () => {
    const live = cardStateOf({ ...base, status: "accepted", claimedAt: new Date(NOW - 60_000).toISOString() }, undefined, NOW);
    expect(live).toMatchObject({ mode: "held", canAccept: false, canDecline: false });
    const stale = cardStateOf({ ...base, status: "accepted", claimedAt: null }, undefined, NOW);
    expect(stale).toMatchObject({ mode: "held", canAccept: false });
    expect(stale.note).toMatch(/not be run again/);
  });
});

describe("cardStateOf - what the last answer says", () => {
  it("submitting disables both buttons", () => {
    expect(cardStateOf(base, { phase: "submitting", decision: "accept" })).toMatchObject({
      mode: "submitting",
      canAccept: false,
      canDecline: false,
    });
  });

  it("a 200 refusal paints its detail with a refusal tone and no buttons", () => {
    const result = parseResolveResponse(200, {
      id: "p1",
      status: "accepted",
      outcome: { ok: false, kind: "refused", detail: "Every one of those items had already moved on" },
      summary: null,
    });
    const s = cardStateOf(base, { phase: "settled", result });
    expect(s).toMatchObject({ mode: "answered", canAccept: false, canDecline: false });
    expect(s.outcome).toEqual({ detail: "Every one of those items had already moved on", tone: "refusal" });
  });

  it("a 409 is answered elsewhere and names the lifecycle state; it never re-enables Accept", () => {
    const result = parseResolveResponse(409, { error: "That proposal has already been answered.", status: "claimed" });
    expect(result).toMatchObject({ kind: "conflict", state: "claimed" });
    const s = cardStateOf(base, { phase: "settled", result });
    expect(s).toMatchObject({ mode: "answered_elsewhere", canAccept: false, canDecline: false });
    // Even when the refetch comes back with the row still open (a lost compare-and-set).
    expect(cardStateOf({ ...base, status: "open" }, { phase: "settled", result }).canAccept).toBe(false);
  });

  it("a 500 after the action failed returns to ask with the error beside it (retry is legitimate)", () => {
    const result = parseResolveResponse(500, { error: "The action failed. Nothing was changed." });
    expect(result.kind).toBe("retryable");
    const s = cardStateOf(base, { phase: "settled", result });
    expect(s).toMatchObject({ mode: "ask", canAccept: true, canDecline: true, error: "The action failed. Nothing was changed." });
  });

  it("a 500 saying it ran but was not recorded is held: NO retry is offered", () => {
    const error =
      "The action ran, but its outcome was not recorded. It will not be run again; check whether it took effect.";
    const result = parseResolveResponse(500, { error });
    expect(result.kind).toBe("ran_unrecorded");
    const s = cardStateOf(base, { phase: "settled", result });
    expect(s).toMatchObject({ mode: "held", canAccept: false, canDecline: false, error });
  });

  it("a 403 shows the door's own reason and leaves the record's state in charge", () => {
    const result = parseResolveResponse(403, { error: "Owners only." });
    expect(result).toMatchObject({ kind: "refused", error: "Owners only." });
    expect(cardStateOf(base, { phase: "settled", result })).toMatchObject({ mode: "ask", error: "Owners only." });
  });

  it("copy carries no em dash", () => {
    const states = [
      cardStateOf({ ...base, status: "expired", resolvedAt: "x" }, undefined, NOW),
      cardStateOf({ ...base, status: "frozen" }, undefined, NOW),
      cardStateOf({ ...base, status: "accepted", claimedAt: null }, undefined, NOW),
      cardStateOf(base, { phase: "settled", result: parseResolveResponse(409, { error: "x", status: "expired" }) }),
    ];
    for (const s of states) expect(JSON.stringify(s)).not.toContain("\u2014");
  });
});

describe("proposalIdsOf", () => {
  it("reads meta.proposalIds defensively", () => {
    expect(proposalIdsOf({ meta: { proposalIds: ["a", "b"] } })).toEqual(["a", "b"]);
    expect(proposalIdsOf({ meta: { proposalIds: "a" } })).toEqual([]);
    expect(proposalIdsOf({ meta: {} })).toEqual([]);
    expect(proposalIdsOf({})).toEqual([]);
  });
});
