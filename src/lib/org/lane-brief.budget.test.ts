import { describe, expect, it } from "vitest";
import { BRIEF_MAX_BYTES, buildLaneBrief, type LaneBriefInput } from "./lane-brief";

function saturated(char: string): LaneBriefInput {
  const dimIds = Array.from({ length: 9 }, (_, i) => `D${i + 1}`);
  return {
    org: "acme", repo: "acme/web", dimIds,
    playbooks: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, title: "Playbook", dimId: "D3", version: 1, summary: char.repeat(100), steps: [char.repeat(100)] })),
    housePattern: Array.from({ length: 60 }, (_, i) => ({ practiceId: `h${i}`, label: "Pattern", dimId: "D3", lines: [char.repeat(100)], exemplars: ["acme/web"] })),
    memories: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, kind: "decision", content: char.repeat(100), source: null })),
    skills: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, name: "Skill", category: "ci-cd", summary: char.repeat(60) })),
    evidence: dimIds.map((dimId) => ({ dimId, name: `EVIDENCE-${dimId}`, score: 50, evidence: [char.repeat(100)], gaps: [char.repeat(40) + ` END-${dimId}`] })),
  };
}

describe("whole lane brief budget", () => {
  it.each(["x", "界", "🚀"])("caps saturated %s text by UTF-8 bytes without stale evidence provenance", (char) => {
    const input = saturated(char);
    const original = structuredClone(input);
    const { text, provenance } = buildLaneBrief(input);
    expect(input).toEqual(original);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(BRIEF_MAX_BYTES);
    expect(provenance.bytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(text).not.toContain("\uFFFD");
    const section = provenance.sections.find((s) => s.kind === "evidence");
    for (const ref of section?.refs ?? []) {
      expect(text).toContain(`EVIDENCE-${ref}`);
      expect(text).toContain(`END-${ref}`);
    }
    if (section) expect(section.refs).toHaveLength(section.count);
    expect(text).toMatch(/trimmed|omitted by the byte budget/);
  });

  it("bounds absence notices even with oversized unknown dimension labels", () => {
    const input = saturated("x");
    input.dimIds = ["🚀".repeat(20_000)];
    input.memories = [];
    const { text, provenance } = buildLaneBrief(input);
    expect(provenance.bytes).toBeLessThanOrEqual(BRIEF_MAX_BYTES);
    expect(text).toContain("list trimmed");
    expect(provenance.sections).toEqual([]);
  });
});
