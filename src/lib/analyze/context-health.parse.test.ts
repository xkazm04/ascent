import { describe, expect, it } from "vitest";
import { deriveContextHealth, parseContextHealthJson } from "./context-health";
import type { RepoSnapshot } from "@/lib/types";

const snapshot = {
  tree: [{ path: "CLAUDE.md", type: "blob", size: 30 }],
  files: [{ path: "CLAUDE.md", content: "Read @missing.md", bytes: 16 }],
} as RepoSnapshot;
const valid = () => deriveContextHealth({ snapshot, freshness: [], commitActivity: null, now: "2026-09-10T00:00:00Z" });

describe("persisted context-health boundary", () => {
  it.each([
    { files: [null] },
    { files: [{ path: 7, sectionsScore: 50 }] },
    { files: [{ path: "CLAUDE.md", sectionsScore: "50" }] },
    { quality: { score: 50, signals: null } },
    { quality: { score: 50, signals: [42] } },
    { freshness: { score: "90", ageDays: null, commitsSinceEdit: null, approximate: true } },
    { drift: { score: 0, refsTotal: 1, deadRefs: null } },
    { drift: { score: 0, refsTotal: 1, deadRefs: [false] } },
    { drift: { score: 0, refsTotal: 1, deadRefs: ["missing.md"], deadRefsTotal: -1 } },
    { drift: { score: 0, refsTotal: 1, deadRefs: ["missing.md"], deadRefsTotal: 2 } },
    { drift: { score: 0, refsTotal: 1, deadRefs: ["missing.md"], deadRefsTotal: 0 } },
    { score: 101 },
  ])("degrades an unreadable nested payload to unassessed: %j", (overrides) => {
    expect(parseContextHealthJson(JSON.stringify({ ...valid(), ...overrides }))).toBeNull();
  });

  it("accepts a current derived blob and a legacy blob without the exact reference total", () => {
    const current = valid();
    expect(parseContextHealthJson(JSON.stringify(current))).toEqual(current);
    delete current.drift.deadRefsTotal;
    expect(parseContextHealthJson(JSON.stringify(current))).toEqual(current);
  });

  it("accepts unknown freshness and empty, assessed guidance populations", () => {
    const empty = deriveContextHealth({ snapshot: { tree: [], files: [] } as unknown as RepoSnapshot, freshness: [], commitActivity: null, now: "2026-09-10T00:00:00Z" });
    expect(parseContextHealthJson(JSON.stringify(empty))).toEqual(empty);
  });
});
