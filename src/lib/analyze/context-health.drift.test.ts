import { describe, expect, it } from "vitest";
import { deriveContextHealth } from "./context-health";
import type { RepoSnapshot } from "@/lib/types";

function health(contents: string[], live: string[] = []) {
  const names = ["CLAUDE.md", "AGENTS.md", ".cursorrules"];
  const files = contents.map((content, i) => ({ path: names[i]!, content, bytes: content.length }));
  const snapshot = {
    tree: [...files.map(f => f.path), ...live].map(path => ({ path, type: "blob", size: 100 })),
    files,
  } as RepoSnapshot;
  return deriveContextHealth({ snapshot, freshness: [], commitActivity: null, now: "2026-09-10T00:00:00Z" });
}
const refs = (n: number) => Array.from({ length: n }, (_, i) => `@docs/missing-${i}.md`).join("\n");

describe("reference drift counts versus bounded examples", () => {
  it("reports zero resolution when all 30 references are dead, retaining only 12 examples", () => {
    const { drift } = health([refs(30)]);
    expect(drift.score).toBe(0);
    expect(drift.refsTotal).toBe(30);
    expect(drift.deadRefsTotal).toBe(30);
    expect(drift.deadRefs).toHaveLength(12);
  });

  it("counts across documents even when the combined examples exceed the cap", () => {
    const { drift } = health([refs(8), refs(8)]);
    expect(drift.score).toBe(0);
    expect(drift.refsTotal).toBe(16);
    expect(drift.deadRefsTotal).toBe(16);
    expect(drift.deadRefs).toHaveLength(12);
  });

  it("uses the actual fraction for mixed live and dead references", () => {
    const live = Array.from({ length: 30 }, (_, i) => `src/live-${i}.ts`);
    const { drift } = health([refs(30) + "\n" + live.map(p => "@" + p).join("\n")], live);
    expect(drift.score).toBe(50);
    expect(drift.refsTotal).toBe(60);
    expect(drift.deadRefsTotal).toBe(30);
    expect(drift.deadRefs).toHaveLength(12);
  });
});
