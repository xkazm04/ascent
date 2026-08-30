// Pins the "Next rung" reading: the distance to the next level's floor, the pace verdict from the
// cohort-matched delta, the periods-to-rung projection, and the lever sentence.

import { describe, it, expect } from "vitest";
import { leverSentence, paceSentence, readNextRung } from "./nextRung";
import type { RepoTrajectory } from "./repoTrajectory";

const badges = (overall: number, delta: number | null, adoption = 61, rigor = 52) => [
  { label: "Org maturity", value: overall, delta },
  { label: "AI Adoption", value: adoption },
  { label: "Engineering Rigor", value: rigor },
  { label: "Repos scanned", value: "36/40" },
];
const repo = (level: string) => ({ level, name: "r", fullName: "a/r" }) as unknown as RepoTrajectory;

describe("readNextRung", () => {
  it("reads the distance to the next rung and projects periods at the period's pace", () => {
    const r = readNextRung(badges(58, 4), [repo("L4"), repo("L3"), repo("L5")]);
    expect(r.level.id).toBe("L3");
    expect(r.next?.id).toBe("L4");
    expect(r.distance).toBe(7);
    expect(r.verdict).toBe("climbing");
    expect(r.periodsToRung).toBe(2);
    expect(r.lever).toBe("rigor");
    expect(r.atNextRung).toBe(2);
    expect(r.scanned).toBe("36/40");
    expect(paceSentence(r, "30 days")).toBe("Up 4 vs 30 days. Two more periods like this one would reach Integrated.");
    expect(leverSentence(r)).toBe("Adoption 61 leads · Rigor 52 trails — rigor is the lever.");
  });

  it("mutes a within-noise move as holding and reads a decline as slipping", () => {
    expect(readNextRung(badges(58, 1), [repo("L3")]).verdict).toBe("holding");
    const s = readNextRung(badges(58, -5), [repo("L3")]);
    expect(s.verdict).toBe("slipping");
    expect(s.periodsToRung).toBeNull();
    expect(paceSentence(s, "90 days")).toBe("Down 5 vs 90 days — the fleet is slipping.");
  });

  it("has no rung above L5 and no reading without scored repos", () => {
    const top = readNextRung(badges(90, 2), [repo("L5")]);
    expect(top.next).toBeNull();
    expect(top.distance).toBe(0);
    expect(readNextRung(badges(58, 4), []).avg).toBeNull();
    expect(readNextRung(badges(58, null), [repo("L3")]).verdict).toBeNull();
  });
});
