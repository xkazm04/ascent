// The follow-ups loop, pinned at its three pure joints: the trailer parser, the resolve rule for
// in-progress rows, and the prompt builder's shape.

import { describe, it, expect } from "vitest";
import { FOLLOWUP_TRAILER, buildFixPrompt, decideInProgress, isRestated, parseResolvedIds, resolutionNote, type FollowUpItem } from "./followups";

const item = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-1",
  repo: "acme/api",
  title: "Agent guidance is thin — agents have little to go on",
  dimId: "D1",
  dimLabel: "AI Tooling",
  impact: "high",
  effort: "low",
  rationale: "Without guidance every AI change re-derives the conventions.",
  explore: ["Which conventions do reviewers repeat most?"],
  projectedPoints: 6,
  ...over,
});

describe("parseResolvedIds", () => {
  it("reads one or several ids per trailer line, across commits, case-insensitively", () => {
    const ids = parseResolvedIds([
      "feat: add CLAUDE.md\n\nAscent-Resolves: rec-1",
      "fix tests\n\nascent-resolves: rec-2, rec-3\nCo-Authored-By: x",
      "unrelated commit",
    ]);
    expect([...ids].sort()).toEqual(["rec-1", "rec-2", "rec-3"]);
  });

  it("ignores the key when it is not at the start of a line (prose mention, not a trailer)", () => {
    expect(parseResolvedIds(["this mentions Ascent-Resolves: rec-9 in a sentence"]).size).toBe(0);
  });
});

describe("decideInProgress — the resolve rule", () => {
  it("a trailer wins even when the scan still restates the gap", () => {
    expect(decideInProgress({ id: "a" }, true, new Set(["a"]))).toEqual({ kind: "done", reason: "trailer" });
  });
  it("not restated → done; restated without a trailer → keep", () => {
    expect(decideInProgress({ id: "a" }, false, new Set())).toEqual({ kind: "done", reason: "not-restated" });
    expect(decideInProgress({ id: "a" }, true, new Set())).toEqual({ kind: "keep" });
  });
});

// Tiers 1-2 only. The third tier (lone-in-dimension pairing) is what carry-forward uses for OPEN
// rows and is excluded here on purpose: since r6 every below-green dimension always has some item,
// so a fixed gap would otherwise be paired with the dimension's next gap and stay "in progress".
describe("isRestated — title tiers only", () => {
  const prev = { dim: "D2", title: "No coverage threshold fails a run." };
  it("matches exact and normalised (case/punctuation) restatements", () => {
    expect(isRestated(prev, [{ dim: "D2", title: "No coverage threshold fails a run." }])).toBe(true);
    expect(isRestated(prev, [{ dim: "D2", title: "no coverage threshold fails a run" }])).toBe(true);
  });
  it("does NOT pair with a different gap in the same dimension, even when it is the only one", () => {
    expect(isRestated(prev, [{ dim: "D2", title: "Snapshot tests can bless a regression wholesale" }])).toBe(false);
  });
});

describe("resolutionNote", () => {
  it("names the mechanism and the scan", () => {
    expect(resolutionNote({ kind: "done", reason: "trailer" }, "abc123")).toContain(FOLLOWUP_TRAILER);
    expect(resolutionNote({ kind: "done", reason: "not-restated" }, "abc123")).toContain("no longer raised");
    expect(resolutionNote({ kind: "keep" }, "abc123")).toBe("");
  });
});

describe("buildFixPrompt", () => {
  const ctx = { org: "acme", generatedAt: "2026-08-17" };

  it("writes one section per repo, biggest projected gain first, items by impact then effort", () => {
    const p = buildFixPrompt(
      [
        item({ id: "a", repo: "acme/web", impact: "low", projectedPoints: 1 }),
        item({ id: "b", repo: "acme/api", impact: "medium", projectedPoints: 4 }),
        item({ id: "c", repo: "acme/api", impact: "high", projectedPoints: 5 }),
      ],
      ctx,
    );
    const apiAt = p.indexOf("## acme/api");
    const webAt = p.indexOf("## acme/web");
    expect(apiAt).toBeGreaterThan(-1);
    expect(apiAt).toBeLessThan(webAt); // 9 pts before 1 pt
    expect(p.indexOf("id: `c`")).toBeLessThan(p.indexOf("id: `b`")); // high before medium
    expect(p).toContain("up to +9 maturity points");
  });

  it("carries the scan's own words and the trailer instruction, and names every id", () => {
    const p = buildFixPrompt([item()], ctx);
    expect(p).toContain("Agent guidance is thin");
    expect(p).toContain("Why it matters: Without guidance");
    expect(p).toContain("Which conventions do reviewers repeat most?");
    expect(p).toContain(`\`${FOLLOWUP_TRAILER}: <id>\``);
    expect(p).toContain("id: `rec-1`");
    expect(p).toContain("1 item across 1 repository");
  });

  it("is deterministic for the same input", () => {
    const items = [item({ id: "x" }), item({ id: "y", repo: "acme/web" })];
    expect(buildFixPrompt(items, ctx)).toBe(buildFixPrompt(items, ctx));
  });
});
