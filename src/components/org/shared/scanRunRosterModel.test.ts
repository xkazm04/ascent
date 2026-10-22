// The fleet scan's finish line as a roster: every non-scored repo named, grouped by the fix it needs,
// and the failures re-selected so one action retries exactly them. Counts are re-derived from the
// lists (never incremented), and the stream and the queue poll fold into ONE roster keyed by repo.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orgTabHref } from "@/lib/org/orgTabs";
import {
  DEGRADED_SCAN_ERROR_TEXT,
  emptyRoster,
  failedCount,
  foldQueueSnapshot,
  foldStreamFrame,
  retryLabel,
  retryScope,
  rosterGroups,
  skippedCount,
  type ScanRunRoster,
} from "./scanRunRosterModel";

function streamed(): ScanRunRoster {
  let r = emptyRoster();
  r = foldStreamFrame(r, "repo", { repo: "a/x", error: "boom", charged: false });
  r = foldStreamFrame(r, "repo", { repo: "a/y", skipped: "no_token" });
  r = foldStreamFrame(r, "repo", { repo: "a/z", level: "L3", overall: 61 });
  return r;
}

const snapshot = {
  repos: [
    { repo: "a/q", state: "failed", error: "lease expired after max attempts" },
    { repo: "a/x", state: "failed", error: "boom" },
  ],
};

describe("foldStreamFrame", () => {
  it("names each repo in the bucket its frame puts it in", () => {
    const r = streamed();
    expect(r.failed.map((f) => f.repo)).toEqual(["a/x"]);
    expect(r.skipped.no_token).toEqual(["a/y"]);
    expect(r.scored).toEqual(["a/z"]);
    expect(r.failed[0]).toMatchObject({ reason: "boom", chargedOnce: false, degraded: false });
  });

  it("a mock-degraded scan is a retryable engine failure, never scored and never charged", () => {
    const r = foldStreamFrame(emptyRoster(), "repo", { repo: "a/d", error: DEGRADED_SCAN_ERROR_TEXT, charged: false });
    expect(r.scored).toEqual([]);
    expect(r.failed).toEqual([expect.objectContaining({ repo: "a/d", degraded: true, chargedOnce: false })]);
    expect(retryScope(r)).toEqual({ repos: ["a/d"] });
  });

  it("credit skips: up-front notice count plus named mid-run skips, until the result's authoritative total", () => {
    let r = foldStreamFrame(emptyRoster(), "notice", { reason: "insufficient_credits", scanning: 2, skipped: 3 });
    r = foldStreamFrame(r, "repo", { repo: "a/c", skipped: "insufficient_credits" });
    expect(skippedCount(r, "insufficient_credits")).toBe(4);
    r = foldStreamFrame(r, "result", { skippedForCredits: 5, skippedNoToken: 0 });
    expect(skippedCount(r, "insufficient_credits")).toBe(5);
  });

  it("a repo moves between buckets rather than being counted twice", () => {
    let r = foldStreamFrame(emptyRoster(["a/x"]), "repo", { repo: "a/x", error: "boom" });
    expect(r.pending).toEqual([]);
    r = foldStreamFrame(r, "repo", { repo: "a/x", level: "L2", overall: 40 });
    expect(r.failed).toEqual([]);
    expect(r.scored).toEqual(["a/x"]);
  });
});

describe("foldQueueSnapshot", () => {
  it("merges by repo identity: no double count, the snapshot reason wins, the count is re-derived", () => {
    const r = foldQueueSnapshot(streamed(), snapshot);
    expect(r.failed.map((f) => f.repo)).toEqual(["a/x", "a/q"]);
    expect(r.failed.find((f) => f.repo === "a/q")?.reason).toBe("lease expired after max attempts");
    expect(failedCount(r)).toBe(2);
  });

  it("a worker-settled degraded job (state skipped + the degrade error) lands with the failures, not done", () => {
    const r = foldQueueSnapshot(emptyRoster(), { repos: [{ repo: "a/d", state: "skipped", error: DEGRADED_SCAN_ERROR_TEXT, charged: false }] });
    expect(r.scored).toEqual([]);
    expect(r.failed).toEqual([expect.objectContaining({ repo: "a/d", degraded: true })]);
  });

  it("maps the worker's skip errors onto the fix they need", () => {
    const r = foldQueueSnapshot(emptyRoster(), {
      repos: [
        { repo: "a/1", state: "skipped", error: "insufficient credits" },
        { repo: "a/2", state: "skipped", error: "installation token unavailable" },
        { repo: "a/3", state: "skipped", error: "failure backoff" },
        { repo: "a/4", state: "queued", error: null },
        { repo: "a/5", state: "done", error: null },
      ],
    });
    expect(r.skipped.insufficient_credits).toEqual(["a/1"]);
    expect(r.skipped.no_token).toEqual(["a/2"]);
    expect(r.skipped.other).toEqual(["a/3"]);
    expect(r.pending).toEqual(["a/4"]);
    expect(r.scored).toEqual(["a/5"]);
  });

  it("tolerates a snapshot with no repo list (an older or partial poll answer)", () => {
    const before = streamed();
    expect(foldQueueSnapshot(before, { pending: 3 })).toEqual(before);
  });
});

describe("retryScope", () => {
  it("re-selects the failures only", () => {
    let r = foldQueueSnapshot(streamed(), snapshot);
    r = foldStreamFrame(r, "repo", { repo: "a/c", skipped: "insufficient_credits" });
    r = foldStreamFrame(r, "repo", { repo: "a/p", skipped: "in_progress" });
    expect(retryScope(r)).toEqual({ repos: ["a/x", "a/q"] });
  });
});

describe("retryLabel", () => {
  it("discloses a failure that was already charged once", () => {
    let r = foldStreamFrame(emptyRoster(), "repo", { repo: "a/x", error: "persist failed", charged: true });
    r = foldStreamFrame(r, "repo", { repo: "a/w", error: "boom", charged: false });
    expect(r.failed[0].chargedOnce).toBe(true);
    const label = retryLabel(r);
    expect(label).toContain("Retry 2 failed");
    expect(label).toContain("1 already charged once; a retry is a new scan");
    expect(label).not.toContain("\u2014");
  });

  it("says nothing about charges when none were charged", () => {
    expect(retryLabel(streamed())).toBe("Retry 1 failed");
  });
});

describe("rosterGroups", () => {
  it("gives each group the one action its fix needs", () => {
    let r = streamed();
    r = foldStreamFrame(r, "repo", { repo: "a/c", skipped: "insufficient_credits" });
    r = foldStreamFrame(r, "repo", { repo: "a/p", skipped: "in_progress" });
    const groups = rosterGroups(r, "acme");
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey.failed.action).toMatchObject({ kind: "retry" });
    expect(byKey.insufficient_credits.action).toMatchObject({ kind: "credits" });
    expect(byKey.no_token.action).toEqual({ kind: "reconnect", href: orgTabHref("acme", "integrations") });
    expect(byKey.in_progress.action).toBeUndefined();
    for (const g of groups) expect(g.title).not.toContain("\u2014");
  });

  it("omits empty groups, so a clean run renders nothing", () => {
    const r = foldStreamFrame(emptyRoster(), "repo", { repo: "a/z", level: "L3", overall: 61 });
    expect(rosterGroups(r, "acme")).toEqual([]);
  });
});

describe("the degrade marker stays in step with the server", () => {
  it("matches DEGRADED_SCAN_ERROR in scan-consequences.ts", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/scan-consequences.ts"), "utf8");
    expect(src).toContain(`DEGRADED_SCAN_ERROR = ${JSON.stringify(DEGRADED_SCAN_ERROR_TEXT)}`);
  });
});
