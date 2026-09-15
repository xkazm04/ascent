import { describe, expect, it } from "vitest";
import {
  isSkillEventSource,
  normalizeEventSource,
  skillEventSourceLabel,
  SKILL_EVENT_SOURCES,
  SOURCE_DETAIL_MAX,
} from "@/lib/org/skill-event-source";

describe("normalizeEventSource", () => {
  it("passes an exact enum value through with no detail", () => {
    for (const s of SKILL_EVENT_SOURCES) {
      expect(normalizeEventSource(s)).toEqual({ source: s, detail: null });
    }
  });

  it("normalizes the shipped CLI's `cli:<state>` form into source + detail", () => {
    // The whole reason this module exists: reportDrift in scripts/ascent-skills.mjs emits these
    // today, and a naive enum would have rejected every one of them.
    expect(normalizeEventSource("cli:diverged")).toEqual({ source: "cli", detail: "diverged" });
    expect(normalizeEventSource("cli:stale")).toEqual({ source: "cli", detail: "stale" });
    expect(normalizeEventSource("cli:missing")).toEqual({ source: "cli", detail: "missing" });
  });

  it("splits on the FIRST colon only, so a detail may contain colons", () => {
    expect(normalizeEventSource("ci:github:push")).toEqual({ source: "ci", detail: "github:push" });
  });

  it("keeps an unrecognized value as detail rather than dropping the event's provenance", () => {
    expect(normalizeEventSource("jenkins")).toEqual({ source: null, detail: "jenkins" });
    expect(normalizeEventSource("robot:beeping")).toEqual({ source: null, detail: "robot:beeping" });
  });

  it("treats absent / blank as unattributed, not as an unknown client", () => {
    expect(normalizeEventSource(null)).toEqual({ source: null, detail: null });
    expect(normalizeEventSource(undefined)).toEqual({ source: null, detail: null });
    expect(normalizeEventSource("   ")).toEqual({ source: null, detail: null });
  });

  it("is case-insensitive on the enum half and preserves the detail's own case", () => {
    expect(normalizeEventSource("  HOOK ")).toEqual({ source: "hook", detail: null });
    // The source is a closed vocabulary, so it is folded; `detail` is free text a producer chose,
    // so it comes back as written.
    expect(normalizeEventSource("CLI: Diverged")).toEqual({ source: "cli", detail: "Diverged" });
  });

  it("clips detail to the column's width", () => {
    const long = "x".repeat(SOURCE_DETAIL_MAX + 50);
    expect(normalizeEventSource(`cli:${long}`).detail).toHaveLength(SOURCE_DETAIL_MAX);
    expect(normalizeEventSource(long).detail).toHaveLength(SOURCE_DETAIL_MAX);
  });

  it("never returns a leading-colon value as a source", () => {
    expect(normalizeEventSource(":cli")).toEqual({ source: null, detail: ":cli" });
  });
});

describe("isSkillEventSource / label", () => {
  it("closes the set", () => {
    expect(isSkillEventSource("mcp")).toBe(true);
    expect(isSkillEventSource("cli:diverged")).toBe(false);
  });

  it("labels an absent source as a reporting gap", () => {
    expect(skillEventSourceLabel(null)).toBe("Unattributed");
    expect(skillEventSourceLabel("registry")).toBe("Registry");
  });
});
