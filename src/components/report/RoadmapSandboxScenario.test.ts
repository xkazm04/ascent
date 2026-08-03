// The saved scenario's IDENTITY contract.
//
// A scenario stores which roadmap gaps it selected. It would have been trivial to store the
// dimension+title pair the commit bar already joins on — and that pair is exactly what breaks: a live
// LLM rephrases titles between scans (temperature, evidence drift, provider failover), so the next
// scan's roadmap would silently match nothing and a restored plan would come back with its items
// unticked. So selections travel as `recommendationDecisionKey`, the SAME cross-scan identity the
// roadmap dismissal decisions use.
//
// These pin the two halves that make that true: there is ONE implementation of the key (the sandbox
// and the decision store cannot drift apart), and a rephrasing of a title keeps the key.

import { describe, it, expect } from "vitest";
import type { LlmRoadmapItem } from "@/lib/types";
import { recommendationDecisionKey } from "@/lib/report/rec-identity";
import type { SandboxScenarioRecord } from "@/lib/db/sandbox-scenario";
import { canonicalRepo, roadmapItemKey, sameOverrides, shouldRestore } from "./RoadmapSandboxScenario";

const item = (over: Partial<LlmRoadmapItem> = {}): LlmRoadmapItem =>
  ({ title: "Add a CI workflow", dimension: "D2", impact: "high", effort: "medium", ...over }) as LlmRoadmapItem;

describe("roadmapItemKey", () => {
  it("IS recommendationDecisionKey — one identity, not a second lookalike", async () => {
    const repo = "acme/web";
    const it0 = item();
    expect(roadmapItemKey(repo, it0)).toBe(recommendationDecisionKey(repo, it0.dimension, it0.title));
    // …and that is the very function the decision store exports, so the sandbox and a dismissal
    // recorded on the same gap agree on its key.
    const { recommendationDecisionKey: fromDecisions } = await import("@/lib/db/org-decisions");
    expect(fromDecisions).toBe(recommendationDecisionKey);
  });

  it("survives a rewording of case, punctuation and whitespace", async () => {
    const repo = "acme/web";
    const base = roadmapItemKey(repo, item({ title: "Add a CI workflow" }));
    expect(roadmapItemKey(repo, item({ title: "  ADD a CI, workflow!  " }))).toBe(base);
    expect(roadmapItemKey(repo, item({ title: "Add   a   CI   workflow" }))).toBe(base);
  });

  it("separates gaps that differ in substance, dimension, or repo", () => {
    const base = roadmapItemKey("acme/web", item());
    expect(roadmapItemKey("acme/web", item({ title: "Add branch protection" }))).not.toBe(base);
    expect(roadmapItemKey("acme/web", item({ dimension: "D5" }))).not.toBe(base);
    expect(roadmapItemKey("acme/api", item())).not.toBe(base);
  });

  it("keys the repo the way the persistence layer canonicalizes it (lowercased owner/name)", () => {
    expect(canonicalRepo("Facebook", "React")).toBe("facebook/react");
    expect(canonicalRepo(" Acme ", " Web ")).toBe("acme/web");
    // So a display-cased report and a stored row mint the SAME key.
    expect(roadmapItemKey(canonicalRepo("Acme", "Web"), item())).toBe(roadmapItemKey("acme/web", item()));
  });
});

describe("sameOverrides", () => {
  it("is true only when the live sliders still equal the saved ones", () => {
    expect(sameOverrides({ D1: 80 }, { D1: 80 })).toBe(true);
    expect(sameOverrides({}, {})).toBe(true);
    expect(sameOverrides({ D1: 80 }, { D1: 81 })).toBe(false);
    expect(sameOverrides({ D1: 80 }, {})).toBe(false);
    expect(sameOverrides({ D1: 80 }, { D1: 80, D2: 50 })).toBe(false);
  });
});

describe("shouldRestore", () => {
  const saved = { overrides: { D2: 90 }, itemKeys: ["k1"] } as unknown as SandboxScenarioRecord;
  const base = { loaded: true, alreadyAttempted: false, scenario: saved, liveOverrides: {}, liveSelectionCount: 0 };

  it("restores into an untouched sandbox", () => {
    expect(shouldRestore(base)).toBe(true);
  });

  it("waits for the fetch to settle, and never fires twice", () => {
    expect(shouldRestore({ ...base, loaded: false })).toBe(false);
    // A save replaces `scenario`; without the latch that would re-apply the saved model mid-drag.
    expect(shouldRestore({ ...base, alreadyAttempted: true })).toBe(false);
  });

  it("does nothing when there is no saved plan", () => {
    expect(shouldRestore({ ...base, scenario: null })).toBe(false);
  });

  it("refuses to land on top of exploration already in progress", () => {
    // The panel is open while the GET is still in flight, so a fast user CAN drag first. A restore
    // arriving after that would silently throw their model away.
    expect(shouldRestore({ ...base, liveOverrides: { D5: 70 } })).toBe(false);
    expect(shouldRestore({ ...base, liveSelectionCount: 1 })).toBe(false);
  });
});
