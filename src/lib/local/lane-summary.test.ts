// The LLM polish never blocks, never invents and never CONDENSES: it rewrites each headline in
// place (same count in, same count out, merged by index) and a bad answer, a throw or no runner
// keep the derived list.

import { describe, expect, it } from "vitest";
import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { buildLaneSummaryPrompt, parseLaneSummary, polishLaneDeliverables } from "@/lib/local/lane-summary";

const list: LaneDeliverable[] = [
  { headline: "Added permissions scope to 3 workflows", dimId: "D9", kind: "closed", covers: ["rec-1"], evidence: "t1" },
  { headline: "Wired CodeQL on pull_request", dimId: "D9", kind: "closed", covers: ["rec-2"], evidence: "t2", review: "approved" },
  { headline: "Added agent-readable docs", dimId: "D8", kind: "hardened", covers: [], evidence: "D8 +12 · gained runbooks" },
];

describe("parseLaneSummary", () => {
  it("rewrites each headline in place by index, keeping everything else — review included", () => {
    const out = parseLaneSummary(
      '```json\n[{"i":1,"headline":"enabled CodeQL scanning on every PR"},{"i":0,"headline":"Scoped workflow token permissions"},{"i":2,"headline":"Added agent-readable docs"}]\n```',
      list,
    );
    expect(out).toEqual([
      { ...list[0], headline: "Scoped workflow token permissions" },
      { ...list[1], headline: "Enabled CodeQL scanning on every PR" },
      list[2],
    ]);
    expect(out![1]!.review).toBe("approved");
  });
  it("refuses a different count, a reused or invented index, a 9-word headline, or prose", () => {
    // Same count in, same count out — a condensed answer is rejected whole.
    expect(parseLaneSummary('[{"i":0,"headline":"Hardened GitHub CI/CD"}]', list)).toBeNull();
    expect(parseLaneSummary('[{"i":0,"headline":"a"},{"i":0,"headline":"b"},{"i":2,"headline":"c"}]', list)).toBeNull();
    expect(parseLaneSummary('[{"i":0,"headline":"a"},{"i":1,"headline":"b"},{"i":7,"headline":"c"}]', list)).toBeNull();
    expect(
      parseLaneSummary('[{"i":0,"headline":"one two three four five six seven eight nine"},{"i":1,"headline":"b"},{"i":2,"headline":"c"}]', list),
    ).toBeNull();
    expect(parseLaneSummary("Sure! Here are the headlines.", list)).toBeNull();
  });
});

describe("polishLaneDeliverables", () => {
  it("keeps the derived list with no runner, on a throw, and on an unusable answer", async () => {
    expect(await polishLaneDeliverables(list, null)).toEqual(list);
    expect(
      await polishLaneDeliverables(list, async () => {
        throw new Error("timeout");
      }),
    ).toEqual(list);
    expect(await polishLaneDeliverables(list, async () => "nope")).toEqual(list);
  });
  it("hands the runner every row, indexed", async () => {
    let seen = "";
    await polishLaneDeliverables(list, async (p) => {
      seen = p;
      return "[]";
    });
    expect(seen).toBe(buildLaneSummaryPrompt(list));
    expect(seen).toContain("2. [hardened D8] Added agent-readable docs");
  });
});
