// The map's geometry and its module cut: the treemap fills its box exactly, keeps first-seen order
// (so the map does not reshuffle when it grows), and type follows tile size.

import { describe, expect, it } from "vitest";
import { LADDER, binaryTreemap, cellTier, fitModuleLabel, groupModules, layoutMap, moduleTier } from "./heatLayout";
import { baseName, moduleLabel, moduleOf } from "./heatModules";
import type { FileHeat } from "./heatTypes";

const f = (path: string, seenAt = 0): FileHeat => ({ path, module: moduleOf(path), seenAt, readAt: null, editAt: null, read: true, edited: false });
const area = (r: { w: number; h: number }) => r.w * r.h;

describe("module cut", () => {
  it("is the file's folder, capped at three segments; the repo root is its own module", () => {
    expect(moduleOf("src/scoring/claims.ts")).toBe("src/scoring/");
    expect(moduleOf("app/api/cases/route.ts")).toBe("app/api/cases/");
    expect(moduleOf("src/features/inflight/live/theater/x.tsx")).toBe("src/features/inflight/");
    expect(moduleOf("./docs/SCORING.md")).toBe("docs/");
    expect(moduleOf("src\\win\\path.ts")).toBe("src/win/");
    expect(moduleOf("package.json")).toBe("");
  });

  it("labels a module in two voices and names the root", () => {
    expect(moduleLabel("app/api/cases/")).toEqual({ dim: "app/api/", name: "cases/" });
    expect(moduleLabel("docs/")).toEqual({ dim: "", name: "docs/" });
    expect(moduleLabel("")).toEqual({ dim: "", name: "repo root" });
    expect(baseName("src/scoring/claims.ts")).toBe("claims.ts");
  });
});

describe("ordered binary treemap", () => {
  const box = { x: 0, y: 0, w: 800, h: 500 };
  const items = [5, 1, 3, 2, 8, 1].map((weight, i) => ({ key: i, weight }));

  it("tiles the box exactly, each item's area proportional to its weight", () => {
    const out = binaryTreemap(items, box);
    const total = items.reduce((s, i) => s + i.weight, 0);
    expect(out.reduce((s, o) => s + area(o.rect), 0)).toBeCloseTo(area(box), 6);
    for (const o of out) expect(area(o.rect) / area(box)).toBeCloseTo(items[o.key]!.weight / total, 6);
  });

  it("keeps the input order (no re-sort by size)", () => {
    expect(binaryTreemap(items, box).map((o) => o.key)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("handles nothing and one", () => {
    expect(binaryTreemap([], box)).toEqual([]);
    expect(binaryTreemap([{ key: "a", weight: 3 }], box)).toEqual([{ key: "a", rect: box }]);
  });
});

describe("grouping and layout", () => {
  it("groups by module, keeping a top-level folder's modules together in first-seen order", () => {
    const files = [f("src/a/1.ts"), f("app/x/1.ts"), f("src/b/1.ts"), f("src/a/2.ts")];
    expect(groupModules(files).map((g) => [g.module, g.files.length])).toEqual([
      ["src/a/", 2],
      ["src/b/", 1],
      ["app/x/", 1],
    ]);
  });

  it("places every cell inside its module and every module inside the box", () => {
    const files = ["src/a/1.ts", "src/a/2.ts", "src/a/3.ts", "src/b/1.ts", "docs/x.md", "package.json"].map((p) => f(p));
    const boxes = layoutMap(files, 1200, 700);
    expect(boxes.flatMap((b) => b.cells.map((c) => c.file.path)).sort()).toEqual(files.map((x) => x.path).sort());
    for (const b of boxes) {
      expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(1200 + 1e-6);
      expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(700 + 1e-6);
      for (const c of b.cells) {
        expect(c.rect.x).toBeGreaterThanOrEqual(0);
        expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(b.rect.w + 1e-6);
        expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(b.rect.h + 1e-6);
      }
    }
  });

  it("type follows the tile: big tiles speak big, tiny ones stay silent", () => {
    expect(moduleTier(900, 300)?.cls).toBe("type-display");
    expect(moduleTier(1800, 600)?.cls).toBe("text-6xl");
    expect(moduleTier(200, 130)?.cls).toBe("type-mono-sm");
    expect(moduleTier(60, 30)).toBeNull();
    expect(cellTier(300, 80)).toBe("type-title");
    expect(cellTier(760, 180)).toBe("text-5xl");
    expect(cellTier(760, 180, 25)).toBe("type-heading");
    expect(cellTier(50, 20)).toBeNull();
  });

  it("a module label keeps its whole path when it can, shrinking a little first, dropping the dim prefix last", () => {
    const tier = moduleTier(900, 300)!; // 31 px
    expect(fitModuleLabel(tier, 17, 400)).toEqual({ cls: "type-display", px: 31, full: true });
    expect(fitModuleLabel(tier, 17, 240)).toEqual({ cls: "type-title", px: 21, full: true });
    expect(fitModuleLabel(tier, 17, 150)).toEqual({ cls: "type-display", px: 31, full: false });
  });

  it("a floor forbids the shrink: given one, the label drops its prefix instead of going under it", () => {
    const tier = moduleTier(900, 300)!; // 31 px
    expect(fitModuleLabel(tier, 17, 240, 31)).toEqual({ cls: "type-display", px: 31, full: false });
  });

  it("the folder is always the louder word: no cell's label reaches its module's", () => {
    const paths = ["src/scoring/claims.ts", "src/scoring/claims.test.ts", "app/api/auth/session.ts", "docs/SCORING.md", "package.json"];
    const px = new Map(LADDER.map(([size, cls]) => [cls, size]));
    for (const [w, h] of [
      [1200, 700],
      [640, 380],
      [3400, 1800],
    ] as const) {
      for (const b of layoutMap(paths.map((p) => f(p)), w, h)) {
        const label = b.label ? px.get(b.label.cls)! : Number.POSITIVE_INFINITY;
        for (const c of b.cells) if (c.label) expect(px.get(c.label)!).toBeLessThan(label);
      }
    }
  });
});
