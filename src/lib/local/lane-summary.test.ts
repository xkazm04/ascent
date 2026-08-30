// The LLM polish never blocks and never invents: a bad answer, a throw or no runner keep the derived list.

import { describe, expect, it } from "vitest";
import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { buildLaneSummaryPrompt, parseLaneSummary, polishLaneDeliverables } from "@/lib/local/lane-summary";

const list: LaneDeliverable[] = [
  { headline: "Added permissions scope to 3 workflows", dimId: "D9", kind: "closed", covers: ["rec-1"], evidence: "t1" },
  { headline: "Wired CodeQL on pull_request", dimId: "D9", kind: "closed", covers: ["rec-2"], evidence: "t2" },
  { headline: "Added agent-readable docs", dimId: "D8", kind: "hardened", covers: [], evidence: "D8 +12 · gained runbooks" },
];

describe("parseLaneSummary", () => {
  it("merges the indexes it names, carries the rest, and caps at four", () => {
    const out = parseLaneSummary('```json\n[{"merges":[0,1],"headline":"hardened GitHub CI/CD"}]\n```', list);
    expect(out).toEqual([
      { headline: "Hardened GitHub CI/CD", dimId: "D9", kind: "closed", covers: ["rec-1", "rec-2"], evidence: "t1" },
      list[2],
    ]);
  });
  it("refuses an invented index, a reused index, a 9-word headline, or prose", () => {
    expect(parseLaneSummary('[{"merges":[7],"headline":"x"}]', list)).toBeNull();
    expect(parseLaneSummary('[{"merges":[0],"headline":"a"},{"merges":[0],"headline":"b"}]', list)).toBeNull();
    expect(parseLaneSummary('[{"merges":[0],"headline":"one two three four five six seven eight nine"}]', list)).toBeNull();
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
