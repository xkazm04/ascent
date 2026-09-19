// The taxonomy mirror: selection (one file per bundle, nothing else under knowledge/), the
// normalization every reader relies on (arrays always arrays, `order` always a number), and the
// degrade rule — a bundle whose taxonomy is missing or malformed mirrors `[]` with a warning.

import { describe, expect, it } from "vitest";
import { isBundleTaxonomy, parseTaxonomy, readBundleTaxonomies, TAXONOMY_SCHEMA } from "./taxonomy";
import { readBundles } from "./index-registry";

const doc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: TAXONOMY_SCHEMA,
    bundle: "software-engineering",
    layout: "nested",
    categories: [
      { id: "ui-surfaces", title: "UI surfaces", order: 1, subcategories: [{ id: "data-display", title: "Data display", subjects: ["table", "feed"] }] },
      { id: "operations", subjects: ["incident-response"] },
    ],
    ...over,
  });

describe("isBundleTaxonomy", () => {
  it("takes knowledge/<domain>/taxonomy.json and nothing else", () => {
    expect(isBundleTaxonomy("knowledge/software-engineering/taxonomy.json")).toBe(true);
    expect(isBundleTaxonomy("knowledge/software-engineering/index.json")).toBe(false);
    expect(isBundleTaxonomy("knowledge/a/b/taxonomy.json")).toBe(false);
    expect(isBundleTaxonomy("taxonomy.json")).toBe(false);
  });
});

describe("parseTaxonomy", () => {
  it("normalizes: arrays always present, order defaults to the index, titles default to ids", () => {
    const parsed = parseTaxonomy(doc());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle).toBe("software-engineering");
    expect(parsed.categories).toEqual([
      { id: "ui-surfaces", title: "UI surfaces", order: 1, subjects: [], subcategories: [{ id: "data-display", title: "Data display", subjects: ["table", "feed"] }] },
      { id: "operations", title: "operations", order: 1, subjects: ["incident-response"], subcategories: [] },
    ]);
  });

  it("refuses a foreign document rather than mirroring an empty tree as if declared", () => {
    expect(parseTaxonomy("{nope")).toMatchObject({ ok: false });
    expect(parseTaxonomy(JSON.stringify({ schema: "other/1", categories: [] }))).toMatchObject({ ok: false, reason: expect.stringContaining("schema") });
    expect(parseTaxonomy(JSON.stringify({ schema: TAXONOMY_SCHEMA }))).toMatchObject({ ok: false, reason: "no categories array" });
  });

  it("drops a category with no id but keeps its siblings", () => {
    const parsed = parseTaxonomy(doc({ categories: [{ title: "nameless" }, { id: "ok" }] }));
    expect(parsed.ok && parsed.categories.map((c) => c.id)).toEqual(["ok"]);
  });
});

describe("readBundleTaxonomies + readBundles", () => {
  const index = (bundle: string) => ({
    path: `knowledge/${bundle}/index.json`,
    text: JSON.stringify({ meta: { bundle, subjects: 1, techniques: 1, applications: 0, laws: 0, categories: ["ui-surfaces"] }, subjects: {} }),
  });

  it("mirrors the taxonomy onto its bundle and [] onto a bundle without one", () => {
    const warnings: string[] = [];
    const taxonomies = readBundleTaxonomies([{ path: "knowledge/software-engineering/taxonomy.json", text: doc() }], warnings);
    const bundles = readBundles([index("software-engineering"), index("media-craft")], warnings, taxonomies);
    expect(bundles.find((b) => b.name === "software-engineering")!.taxonomy).toHaveLength(2);
    expect(bundles.find((b) => b.name === "media-craft")!.taxonomy).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("degrades a malformed taxonomy into a warning, never a failed read", () => {
    const warnings: string[] = [];
    const taxonomies = readBundleTaxonomies(
      [
        { path: "knowledge/broken/taxonomy.json", text: "{not json" },
        { path: "knowledge/unread/taxonomy.json", text: null },
        { path: "knowledge/software-engineering/taxonomy.json", text: doc() },
      ],
      warnings,
    );
    expect([...taxonomies.keys()]).toEqual(["software-engineering"]);
    expect(warnings).toEqual(["knowledge/broken/taxonomy.json: not valid JSON — taxonomy not mirrored"]);
  });

  it("keys by the document's own bundle name, falling back to the directory", () => {
    const taxonomies = readBundleTaxonomies([{ path: "knowledge/dir-name/taxonomy.json", text: doc({ bundle: undefined }) }], []);
    expect([...taxonomies.keys()]).toEqual(["dir-name"]);
  });
});
