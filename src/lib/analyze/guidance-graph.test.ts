import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGuidanceGraph, declaredCanonical } from "@/lib/analyze/guidance-graph";
import { renderProjection } from "@/lib/analyze/guidance-projection";
import type { RepoSnapshot } from "@/lib/types";

function snap(files: Record<string, string>, extraTree: string[] = []): RepoSnapshot {
  const entries = Object.entries(files);
  return {
    meta: { owner: "o", name: "r", fullName: "o/r", defaultBranch: "main", stars: 0, description: null },
    tree: [...entries.map(([path]) => path), ...extraTree].map((path) => ({ path, type: "blob" as const, size: 100 })),
    files: entries.map(([path, content]) => ({ path, content, bytes: content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  } as unknown as RepoSnapshot;
}

const CANON = `# o/r agent guidance

## Commands
- Test: \`npm test\`
- Build: \`npm run build\`

## Rules
- Never commit generated files.
`;

// STRUCTURAL GUARD. `scoring/engine.ts` imports this module's `isGuidancePath` and `analyze/index.ts`
// imports the graph itself — and BOTH are pulled into the client bundle by `RoadmapSandbox.tsx` /
// `ScoreWaterfall.tsx`, which import `contributions`/`projectSandbox` from the engine. A `node:*`
// import anywhere on that path fails `next build` and NOTHING else: `tsc --noEmit` stays green, and so
// does this entire suite, because vitest runs in Node. That is the failure mode this file pins — the
// hashing half lives in `guidance-projection.ts`, which the graph must never import.
describe("the scanner path carries no Node built-ins", () => {
  it.each(["src/lib/analyze/guidance-graph.ts", "src/lib/analyze/context-health.ts"])(
    "%s imports nothing from node:",
    (file) => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/^import .* from ["']node:/m);
      expect(src).not.toMatch(/guidance-projection["']/);
    },
  );
});

describe("coherence — the honest-null floor", () => {
  it("returns null (NOT 0) when the repo has no guidance document", () => {
    const g = buildGuidanceGraph(snap({ "README.md": "hello" }));
    expect(g.nodes).toHaveLength(0);
    // FAIL-BEFORE: any implementation returning 0 here is asserting a verdict about a repo it never
    // assessed. 0 and "not assessed" must never render the same.
    expect(g.coherence).toBeNull();
    expect(g.canonical).toBeNull();
  });

  it("a single document is coherent by construction", () => {
    const g = buildGuidanceGraph(snap({ "AGENTS.md": CANON }));
    expect(g.coherence).toBe(100);
    expect(g.canonical).toBe("AGENTS.md");
    expect(g.penalties).toEqual([]);
  });
});

describe("canonical nomination", () => {
  it("a pointer-only document nominates what it points at (this repo's CLAUDE.md)", () => {
    const g = buildGuidanceGraph(snap({ "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": CANON }));
    expect(g.nodes.find((n) => n.path === "CLAUDE.md")!.pointerOnly).toBe(true);
    expect(g.canonical).toBe("AGENTS.md");
    expect(g.canonicalBasis).toBe("pointer");
    expect(g.coherence).toBe(100);
    expect(g.edges.some((e) => e.from === "CLAUDE.md" && e.to === "AGENTS.md" && e.kind === "points-to")).toBe(true);
  });

  it("the manifest's declaration outranks every heuristic", () => {
    const manifest = "schema: ai-manifest\n\nguidance:\n  canonical: .cursorrules\n\ncontrols:\n  prePush: [lint]\n";
    const g = buildGuidanceGraph(
      snap({ "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": CANON, ".cursorrules": CANON, ".ai/manifest.yaml": manifest }),
    );
    expect(g.canonical).toBe(".cursorrules");
    expect(g.canonicalBasis).toBe("manifest");
  });

  it("declaredCanonical reads only the guidance block", () => {
    expect(declaredCanonical("guidance:\n  canonical: AGENTS.md\n")).toBeNull(); // no leading newline = no block
    expect(declaredCanonical("schema: x\nguidance:\n  canonical: AGENTS.md\n")).toBe("AGENTS.md");
    expect(declaredCanonical("schema: x\npaths:\n  canonical: nope\n")).toBeNull();
  });

  it("stays null with ≥2 documents and nothing to nominate from, and costs 10 points", () => {
    const g = buildGuidanceGraph(snap({ "AGENTS.md": CANON, ".windsurfrules": CANON }));
    expect(g.canonical).toBeNull();
    expect(g.canonicalBasis).toBeNull();
    expect(g.coherence).toBe(90);
    expect(g.penalties[0]!.points).toBe(10);
    expect(g.penalties[0]!.paths).toContain(".windsurfrules");
  });
});

describe("divergence vs projection", () => {
  const drifted = (test: string, build: string, rule: string) =>
    `# guidance\n- Test: \`${test}\`\n- Build: \`${build}\`\n- ${rule}\n`;

  it("four drifting copies land at or below 40 with named penalties", () => {
    const g = buildGuidanceGraph(
      snap({
        "CLAUDE.md": drifted("npm test", "npm run build", "Never commit generated files."),
        "AGENTS.md": drifted("npm run test:ci", "make build", "Always commit generated files."),
        ".cursorrules": drifted("yarn test", "npm run build", "Never commit generated files."),
        ".github/copilot-instructions.md": drifted("bun test", "npm run build", "Never commit generated files."),
      }),
    );
    expect(g.coherence).toBeLessThanOrEqual(40);
    expect(g.contradictions.length).toBeGreaterThan(0);
    // Every deduction names both files it was read from — the re-traceability clause.
    for (const p of g.penalties) expect(p.paths.length).toBeGreaterThanOrEqual(1);
    expect(g.penalties.map((p) => p.reason).join(" ")).toMatch(/different commands|contradictory rule/);
  });

  it("four in-sync projections of one canonical stay at 100", () => {
    const projection = renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON });
    const g = buildGuidanceGraph(
      snap({
        "AGENTS.md": CANON,
        "CLAUDE.md": projection,
        ".cursorrules": projection,
        ".github/copilot-instructions.md": projection,
      }),
    );
    expect(g.canonical).toBe("AGENTS.md");
    expect(g.canonicalBasis).toBe("projection-header");
    expect(g.coherence).toBe(100);
    expect(g.contradictions).toEqual([]);
  });

  it("a hand-edited projection costs the stale-projection penalty", () => {
    const projection = renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON });
    const g = buildGuidanceGraph(
      snap({ "AGENTS.md": CANON, ".cursorrules": projection.replace("npm test", "npm run test:ci") }),
    );
    expect(g.coherence).toBeLessThan(100);
    expect(g.penalties.some((p) => /projection/.test(p.reason))).toBe(true);
  });

  it("an UNFETCHED guidance file never creates a penalty", () => {
    // `.windsurfrules` is in the tree but outside the fetch budget: presence only.
    const g = buildGuidanceGraph(snap({ "AGENTS.md": CANON }, [".windsurfrules"]));
    const unsampled = g.nodes.find((n) => n.path === ".windsurfrules")!;
    expect(unsampled.contentSampled).toBe(false);
    expect(unsampled.commands).toEqual([]);
    // Two nodes, but the unsampled one is not evidence of anything — only the no-canonical rule fires.
    expect(g.penalties.every((p) => !p.paths.includes(".windsurfrules") || /canonical/.test(p.reason))).toBe(true);
    expect(g.contradictions).toEqual([]);
  });
});
