// Pure tests for the knowledge-bundle subject reader (#18), against the REAL index shape:
// `subjects` is a map keyed by slug, and each technique carries `use_when` + `laws`. The dossier
// assumed an array of objects with a `title`; the generated index has neither, and this file is where
// that correction is pinned so it cannot drift back.

import { describe, expect, it } from "vitest";
import { readBundleSubjects } from "./subjects";

const file = (path: string, doc: unknown) => ({ path, text: JSON.stringify(doc) });

const bundle = (name: string, subjects: Record<string, unknown>) => ({
  meta: { bundle: name, subjects: Object.keys(subjects).length },
  subjects,
});

const accessibility = {
  category: "ui-surfaces",
  subcategory: "feedback-and-style",
  status: "forged",
  file: "knowledge/software-engineering/ui-surfaces/feedback-and-style/accessibility/accessibility.md",
  techniques: [
    { slug: "a11y-verification", laws: ["gate-sees-target", "unknown-is-not-a-value"], use_when: ["deciding whether a green audit means accessible"] },
    { slug: "assistive-tech-divergence", laws: ["unknown-is-not-a-value"], use_when: ["focus lands nowhere after a dialog closes"] },
  ],
};

describe("readBundleSubjects", () => {
  it("reads a subject from the map-keyed-by-slug shape", () => {
    // FAIL-BEFORE: no reader existed, so a bundle with 151 subjects produced 0 rows.
    const rows = readBundleSubjects(
      [file("knowledge/software-engineering/index.json", bundle("software-engineering", { accessibility }))],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      bundle: "software-engineering",
      slug: "accessibility",
      category: "ui-surfaces",
      subcategory: "feedback-and-style",
      status: "forged",
      file: accessibility.file,
      techniqueCount: 2,
      useWhen: [
        "deciding whether a green audit means accessible",
        "focus lands nowhere after a dialog closes",
      ],
      laws: ["gate-sees-target", "unknown-is-not-a-value"],
    });
  });

  it("dedupes the law union across techniques rather than counting citations", () => {
    const rows = readBundleSubjects(
      [file("knowledge/se/index.json", bundle("se", { accessibility }))],
      [],
    );
    expect(rows[0]!.laws).toEqual(["gate-sees-target", "unknown-is-not-a-value"]);
    // The COUNT is techniques, not laws — the two answer different questions.
    expect(rows[0]!.techniqueCount).toBe(2);
  });

  it("keeps an unstated category/subcategory/status NULL rather than guessing", () => {
    const rows = readBundleSubjects(
      [file("knowledge/se/index.json", bundle("se", { bare: { file: "knowledge/se/bare.md" } }))],
      [],
    );
    expect(rows[0]).toMatchObject({ category: null, subcategory: null, status: null, techniqueCount: 0, useWhen: [], laws: [] });
  });

  it("skips a subject with no file — nothing a reader could open", () => {
    const warnings: string[] = [];
    const rows = readBundleSubjects(
      [file("knowledge/se/index.json", bundle("se", { ghost: { category: "x" } }))],
      warnings,
    );
    expect(rows).toEqual([]);
    expect(warnings[0]).toContain('subjects["ghost"] has no file');
  });

  it("degrades ONE malformed bundle and still lands the others", () => {
    const warnings: string[] = [];
    const rows = readBundleSubjects(
      [
        { path: "knowledge/broken/index.json", text: "{not json" },
        file("knowledge/se/index.json", bundle("se", { accessibility })),
      ],
      warnings,
    );
    expect(rows.map((r) => r.bundle)).toEqual(["se"]);
    expect(warnings).toEqual(["knowledge/broken/index.json: not valid JSON — subjects not indexed"]);
  });

  it("warns when `subjects` is an array — the shape the dossier assumed", () => {
    const warnings: string[] = [];
    const rows = readBundleSubjects(
      [file("knowledge/se/index.json", { meta: { bundle: "se" }, subjects: [{ slug: "x" }] })],
      warnings,
    );
    expect(rows).toEqual([]);
    expect(warnings[0]).toContain("no subjects map");
  });

  it("falls back to the directory name when meta omits the bundle", () => {
    const rows = readBundleSubjects(
      [file("knowledge/recruiting/index.json", { meta: {}, subjects: { a: { file: "f.md" } } })],
      [],
    );
    expect(rows[0]!.bundle).toBe("recruiting");
  });

  it("skips an unreadable file without a warning of its own", () => {
    // A null text means the capped reader already warned about the read; a second line would only
    // repeat it under a different voice.
    const warnings: string[] = [];
    expect(readBundleSubjects([{ path: "knowledge/se/index.json", text: null }], warnings)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("orders deterministically by (bundle, slug) so an index pass is reproducible", () => {
    const rows = readBundleSubjects(
      [
        file("knowledge/z/index.json", bundle("z", { b: { file: "f" }, a: { file: "f" } })),
        file("knowledge/a/index.json", bundle("a", { c: { file: "f" } })),
      ],
      [],
    );
    expect(rows.map((r) => `${r.bundle}/${r.slug}`)).toEqual(["a/c", "z/a", "z/b"]);
  });

  it("bounds the unions without lying about the technique count", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ use_when: [`trigger ${i}`], laws: [`law ${i}`] }));
    const rows = readBundleSubjects(
      [file("knowledge/se/index.json", bundle("se", { big: { file: "f", techniques: many } }))],
      [],
    );
    expect(rows[0]!.techniqueCount).toBe(100);
    expect(rows[0]!.useWhen).toHaveLength(60);
    expect(rows[0]!.laws).toHaveLength(40);
  });
});
