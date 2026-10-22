// The map's org scan ends on the SAME roster model the dashboard button folds (scanRunRosterModel),
// so an in-band refusal or a queued remainder is never reported as an empty watchlist.

import { describe, expect, it } from "vitest";
import { orgTabHref } from "@/lib/org/orgTabs";
import { emptyRoster, foldStreamFrame, type ScanRunRoster } from "@/components/shared/scan/scanRunRosterModel";
import { EMPTY_WATCHLIST_TEXT, fleetScanOutcome, refusedOutcome } from "./fleetScanOutcomeModel";

const fold = (frames: [string, Record<string, unknown>][]): ScanRunRoster =>
  frames.reduce((r, [event, data]) => foldStreamFrame(r, event, data), emptyRoster());

describe("fleetScanOutcome", () => {
  it("an out-of-credits error frame names the server reason and points at /pricing", () => {
    const text = "Out of scan credits: 3 watched repos couldn't be scanned.";
    const o = fleetScanOutcome("acme", emptyRoster(), text, null);
    expect(o.message).toBe(text);
    expect(o.kind).toBe("credits");
    expect(o.action).toEqual({ kind: "credits", href: "/pricing" });
    expect(o.message).not.toContain("No watched repos to scan");
  });

  it("a server failure frame is a failure carrying that message, not the empty-watchlist copy", () => {
    const o = fleetScanOutcome("acme", emptyRoster(), "Bulk scan failed.", null);
    expect(o.kind).toBe("failed");
    expect(o.message).toBe("Bulk scan failed.");
    expect(o.message).not.toBe(EMPTY_WATCHLIST_TEXT);
  });

  it("a queued remainder with no repo frames is owed work, not an error", () => {
    const o = fleetScanOutcome("acme", emptyRoster(), null, { runId: "r1", pending: 5, total: 5 });
    expect(o.kind).toBe("queued");
    expect(o.pending).toBe(5);
    expect(o.error).toBeUndefined();
    expect(o.message).not.toBe(EMPTY_WATCHLIST_TEXT);
  });

  it("a token-less skip is a named group with a reconnect remedy", () => {
    const roster = fold([
      ["repo", { repo: "acme/a", overall: 70 }],
      ["repo", { repo: "acme/b", skipped: "no_token" }],
      ["result", { skippedNoToken: 1 }],
    ]);
    const o = fleetScanOutcome("acme", roster, null, null);
    const noToken = o.groups.find((g) => g.key === "no_token");
    expect(noToken?.action).toEqual({ kind: "reconnect", href: orgTabHref("acme", "integrations") });
    expect(o.scored).toBe(1);
    expect(o.kind).toBe("partial");
  });

  it("a charged failure offers a retry of exactly it, labelled as a new scan", () => {
    const roster = fold([["repo", { repo: "acme/c", error: "boom", charged: true }]]);
    const o = fleetScanOutcome("acme", roster, null, null);
    expect(o.action?.kind).toBe("retry");
    expect(o.action && "label" in o.action ? o.action.label : "").toContain("already charged once");
    expect(o.retryScope).toEqual({ repos: ["acme/c"] });
  });

  it("keeps the empty-watchlist copy only for a run that truly saw nothing", () => {
    expect(fleetScanOutcome("acme", emptyRoster(), null, null).message).toBe(EMPTY_WATCHLIST_TEXT);
    expect(fleetScanOutcome("acme", fold([["repo", { repo: "acme/a", overall: 70 }]]), null, null).kind).toBe("scored");
  });

  it("a drained queue with no named rows is finished work, not an empty watchlist", () => {
    const o = fleetScanOutcome("acme", emptyRoster(), null, { runId: "r1", pending: 0, total: 5 });
    expect(o.kind).toBe("scored");
    expect(o.message).not.toBe(EMPTY_WATCHLIST_TEXT);
  });

  it("a 402 refusal before the stream carries the credits remedy", () => {
    expect(refusedOutcome("Out of scan credits.", 402).action).toEqual({ kind: "credits", href: "/pricing" });
    expect(refusedOutcome(null, 500).message).toBe("Scan failed (500).");
  });

  it("writes no em dash in any outcome copy", () => {
    const roster = fold([
      ["repo", { repo: "acme/c", error: "boom", charged: true }],
      ["repo", { repo: "acme/b", skipped: "no_token" }],
    ]);
    const outs = [
      fleetScanOutcome("acme", roster, null, { runId: "r", pending: 2, total: 4 }),
      fleetScanOutcome("acme", roster, null, null),
      fleetScanOutcome("acme", emptyRoster(), null, null),
    ];
    for (const o of outs) expect(o.message).not.toContain(String.fromCharCode(0x2014));
  });
});
