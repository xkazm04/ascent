// The row model behind the Briefing tab's issued-links inventory.
//
// These are the honesty rules a list of CAPABILITIES has to hold, and they are all rules about
// absence: a grant that recorded no expiry must never be called expired (an owner told "expired"
// stops revoking a link that may still open), a never-opened link must read as "not opened yet"
// rather than a confident "0 opens", and a revoked grant must not share a word with an expired one
// because only one of the two was somebody's decision.

import { describe, expect, it } from "vitest";
import type { BriefingShareGrant } from "@/lib/db/org-share";
import { shareLinkRows } from "./shareLinkRows";

const grant = (over: Partial<BriefingShareGrant> = {}): BriefingShareGrant => ({
  jti: "jti-1",
  mintedAt: "2026-09-01T10:00:00.000Z",
  mintedBy: "ada",
  expiresAt: "2026-09-08T10:00:00.000Z",
  window: { start: "2026-06-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
  segment: null,
  stack: null,
  revoked: false,
  expired: false,
  opens: 0,
  lastOpenedAt: null,
  ...over,
});

describe("shareLinkRows", () => {
  // Acceptance 1: the fields an owner needs to decide whether a link should still exist.
  it("renders newest first and carries minter, scope, frozen window and expiry", () => {
    const rows = shareLinkRows([
      grant({ jti: "older", mintedAt: "2026-08-01T00:00:00.000Z" }),
      grant({ jti: "newer", mintedAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.jti)).toEqual(["newer", "older"]);
    const [r] = rows;
    expect(r.mintedByLabel).toBe("ada");
    expect(r.mintedAtLabel).toBe("2026-09-20");
    expect(r.scopeLabel).toBe("Whole org");
    expect(r.windowLabel).toBe("2026-06-01 to 2026-09-01");
    expect(r.expiryLabel).toBe("expires 2026-09-08");
  });

  it("names a segment scope, a stack scope and both together", () => {
    const [seg] = shareLinkRows([grant({ segment: "acme-bank" })]);
    expect(seg.scopeLabel).toBe("Segment acme-bank");
    const [stack] = shareLinkRows([grant({ stack: "frontend" })]);
    expect(stack.scopeLabel).toBe("Stack frontend");
    const [both] = shareLinkRows([grant({ segment: "acme-bank", stack: "frontend" })]);
    expect(both.scopeLabel).toBe("Segment acme-bank, stack frontend");
  });

  it("says all time when the frozen window has no start, and says so when none was recorded", () => {
    const [allTime] = shareLinkRows([grant({ window: { start: null, end: "2026-09-01T00:00:00.000Z" } })]);
    expect(allTime.windowLabel).toBe("All time to 2026-09-01");
    const [none] = shareLinkRows([grant({ window: null })]);
    expect(none.windowLabel).toBe("Window not recorded");
  });

  it("names the deployment that binds no minter instead of printing an empty cell", () => {
    const [r] = shareLinkRows([grant({ mintedBy: null })]);
    expect(r.mintedByLabel).toBe("Minter not recorded");
  });

  // Acceptance 3: three distinct status words, and only a live grant offers Revoke.
  it("gives a revoked and an expired grant different words, and neither can be revoked", () => {
    const [revoked] = shareLinkRows([grant({ revoked: true })]);
    const [expired] = shareLinkRows([grant({ expired: true })]);
    const [live] = shareLinkRows([grant()]);
    expect(revoked.status).toBe("revoked");
    expect(revoked.statusLabel).toBe("Revoked");
    expect(expired.status).toBe("expired");
    expect(expired.statusLabel).toBe("Expired");
    expect(expired.statusLabel).not.toBe(revoked.statusLabel);
    expect(live.statusLabel).toBe("Live");
    expect(revoked.canRevoke).toBe(false);
    expect(expired.canRevoke).toBe(false);
    expect(live.canRevoke).toBe(true);
  });

  it("calls a grant that is both revoked and expired revoked, because that one was a decision", () => {
    const [r] = shareLinkRows([grant({ revoked: true, expired: true })]);
    expect(r.status).toBe("revoked");
  });

  // Acceptance 3, the half that matters most: no recorded expiry is NOT an expiry.
  it("never shows a grant whose mint row recorded no expiry as expired", () => {
    const [r] = shareLinkRows([grant({ expiresAt: null, expired: true })]);
    expect(r.status).toBe("live");
    expect(r.expiryLabel).toBe("No recorded expiry");
    expect(r.canRevoke).toBe(true);
  });

  // Acceptance 4: absence is phrased, never rendered as a zero.
  it("phrases opens as not-opened-yet or a count with its last open", () => {
    const [never] = shareLinkRows([grant({ opens: 0, lastOpenedAt: null })]);
    expect(never.opensLabel).toBe("Not opened yet");
    const [once] = shareLinkRows([grant({ opens: 1, lastOpenedAt: "2026-09-03T00:00:00.000Z" })]);
    expect(once.opensLabel).toBe("Opened 1 time, last 2026-09-03");
    const [many] = shareLinkRows([grant({ opens: 4, lastOpenedAt: "2026-09-05T00:00:00.000Z" })]);
    expect(many.opensLabel).toBe("Opened 4 times, last 2026-09-05");
    expect(never.opensLabel).not.toMatch(/\b0\b/);
  });

  it("does not claim a last open it was not given", () => {
    const [r] = shareLinkRows([grant({ opens: 2, lastOpenedAt: null })]);
    expect(r.opensLabel).toBe("Opened 2 times");
  });

  it("tolerates an unparseable timestamp rather than throwing on the whole list", () => {
    const [r] = shareLinkRows([grant({ mintedAt: "not a date", expiresAt: "nope" })]);
    expect(r.mintedAtLabel).toBe("Date not recorded");
    expect(r.expiryLabel).toBe("No recorded expiry");
  });
});
