// THE PROPOSAL GATE, WRITTEN DOWN. Every state is named, every edge is in one table, and an illegal
// edge comes back as a conflict carrying the current state - never as a silent no-op or a guess.

import { describe, it, expect } from "vitest";
import {
  ATHENA_CLAIM_STALE_MS,
  ATHENA_PROPOSAL_TTL_DAYS,
  askHasExpired,
  canAccept,
  canDecline,
  lifecycleOf,
  transition,
} from "@/lib/athena/proposal-lifecycle";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe("lifecycleOf derives one named state from the row", () => {
  it("names a claim, and names a STALE claim, instead of implying either from a pair of columns", () => {
    const row = { status: "accepted", resolvedAt: null, claimedAt: ago(20 * MIN) };
    expect(lifecycleOf(row, NOW)).toBe("claimed_stale");
    expect(lifecycleOf({ ...row, claimedAt: ago(1 * MIN) }, NOW)).toBe("claimed");
  });

  it("reads an unrecognised status as 'unknown', and 'unknown' is not actionable (no fail-open)", () => {
    expect(lifecycleOf({ status: "banana" })).toBe("unknown");
    expect(canAccept("unknown")).toBe(false);
    expect(canDecline("unknown")).toBe(false);
  });

  it("reads a pre-migration claim (no claimedAt) as stale - its age cannot be known", () => {
    expect(lifecycleOf({ status: "accepted", resolvedAt: null, claimedAt: null }, NOW)).toBe("claimed_stale");
  });

  it("reads the closed states as themselves", () => {
    expect(lifecycleOf({ status: "accepted", resolvedAt: ago(MIN) }, NOW)).toBe("accepted");
    expect(lifecycleOf({ status: "declined", resolvedAt: ago(MIN) }, NOW)).toBe("declined");
    expect(lifecycleOf({ status: "expired", resolvedAt: ago(MIN) }, NOW)).toBe("expired");
    // Expiry is a WRITE, never a read-side filter: an old open row is still open until the sweep runs.
    expect(lifecycleOf({ status: "open", createdAt: ago(90 * 86_400_000) }, NOW)).toBe("open");
  });

  it("puts the stale threshold past any request that could still be running", () => {
    expect(ATHENA_CLAIM_STALE_MS).toBeGreaterThan(300_000);
    expect(ATHENA_PROPOSAL_TTL_DAYS).toBe(14);
  });
});

describe("transition: illegal edges are conflicts that carry the current state", () => {
  it("refuses accept on a declined or expired ask, and decline on a claim", () => {
    expect(transition("declined", "accept")).toEqual({ ok: false, conflict: true, current: "declined" });
    expect(transition("expired", "accept")).toEqual({ ok: false, conflict: true, current: "expired" });
    expect(transition("claimed", "decline")).toEqual({ ok: false, conflict: true, current: "claimed" });
  });

  it("GUARD: an open ask accepts into a claim (the compare-and-set semantics, made explicit)", () => {
    expect(transition("open", "accept")).toMatchObject({ ok: true, next: "claimed" });
  });

  it("names who drives each edge, and a stale claim is interrupted - never released for a retry", () => {
    expect(transition("open", "decline")).toMatchObject({ ok: true, next: "declined", by: "human" });
    expect(transition("open", "expire")).toMatchObject({ ok: true, next: "expired", by: "sweep" });
    expect(transition("claimed", "stamp")).toMatchObject({ ok: true, next: "accepted", by: "resolver" });
    expect(transition("claimed", "release")).toMatchObject({ ok: true, next: "open", by: "resolver" });
    expect(transition("claimed_stale", "interrupt")).toMatchObject({ ok: true, next: "accepted", by: "sweep" });
    expect(transition("claimed_stale", "release")).toMatchObject({ ok: false, conflict: true });
    expect(transition("unknown", "decline")).toMatchObject({ ok: false, conflict: true, current: "unknown" });
  });
});

describe("askHasExpired is the one clock for an unanswered ask", () => {
  it("expires an open ask older than the TTL, and nothing younger", () => {
    expect(askHasExpired(ago(15 * 86_400_000), NOW)).toBe(true);
    expect(askHasExpired(ago(13 * 86_400_000), NOW)).toBe(false);
  });
});
