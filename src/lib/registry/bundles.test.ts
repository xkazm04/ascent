// The knowledge/ lane, from ascent's side.
//
// A Reference Knowledge Bundle is ~1,000 markdown documents. Ascent reads ONE
// file per bundle — the generated index — and takes its counts verbatim. Both
// halves of that are deliberate and both are asserted here: selecting only the
// index, and not recomputing what the bundle's own generator already states.

import { describe, expect, it } from "vitest";

import { readBundles } from "./index-registry";
import { isBundleIndex } from "./index-walk";

const index = (bundle: string, meta: Record<string, unknown> = {}) => ({
  path: `knowledge/${bundle}/index.json`,
  text: JSON.stringify({
    meta: {
      bundle,
      subjects: 105,
      techniques: 624,
      applications: 236,
      laws: 9,
      categories: ["ui-surfaces", "operations"],
      use_when_coverage: "0/624",
      ...meta,
    },
    subjects: { table: {} },
  }),
});

describe("isBundleIndex", () => {
  it("takes the generated index and nothing else under knowledge/", () => {
    expect(isBundleIndex("knowledge/software-engineering/index.json")).toBe(true);
    // The markdown is the bundle; indexing it would blow the file cap and tell
    // us nothing index.json does not already state.
    expect(isBundleIndex("knowledge/software-engineering/table/table.md")).toBe(false);
    expect(isBundleIndex("knowledge/README.md")).toBe(false);
    expect(isBundleIndex("knowledge/a/b/index.json")).toBe(false);
    expect(isBundleIndex("usage/dev-box.json")).toBe(false);
  });
});

describe("readBundles", () => {
  it("takes meta verbatim rather than recomputing it", () => {
    const [b] = readBundles([index("software-engineering")], []);
    expect(b).toEqual({
      name: "software-engineering",
      subjects: 105,
      techniques: 624,
      applications: 236,
      laws: 9,
      categories: ["ui-surfaces", "operations"],
      useWhenCoverage: "0/624",
    });
  });

  it("sorts by name so an index pass is deterministic", () => {
    const got = readBundles([index("media-craft"), index("software-engineering")], []);
    expect(got.map((b) => b.name)).toEqual(["media-craft", "software-engineering"]);
  });

  it("degrades ONE malformed bundle, never the pass", () => {
    const warnings: string[] = [];
    const got = readBundles(
      [
        { path: "knowledge/broken/index.json", text: "{not json" },
        { path: "knowledge/metaless/index.json", text: JSON.stringify({ subjects: {} }) },
        index("software-engineering"),
      ],
      warnings,
    );
    expect(got.map((b) => b.name)).toEqual(["software-engineering"]);
    expect(warnings).toHaveLength(2);
  });

  it("falls back to the directory name when meta does not name the bundle", () => {
    const [b] = readBundles([index("software-engineering", { bundle: undefined })], []);
    expect(b!.name).toBe("software-engineering");
  });

  it("reads a non-number count as 0 rather than NaN", () => {
    // A NaN would render as "NaN subjects" and survive every arithmetic check;
    // 0 is wrong in the same direction as "not reported", which is legible.
    const [b] = readBundles([index("x", { subjects: "lots", techniques: null })], []);
    expect(b!.subjects).toBe(0);
    expect(b!.techniques).toBe(0);
  });

  it("skips an unreadable blob without inventing a bundle", () => {
    expect(readBundles([{ path: "knowledge/x/index.json", text: null }], [])).toEqual([]);
  });
});
