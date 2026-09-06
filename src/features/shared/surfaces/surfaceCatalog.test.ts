// The catalog ⇄ body-map bijection. A showcase is registered in two places — a record in
// `SURFACE_CATALOG` and an `import()` in `SURFACE_BODIES` — and this test refuses either half alone,
// plus: every record names a real ui-surfaces subject, slugs are unique, and every `techniqueSlugs`
// entry has a matching drawer entry in the body's `techniques` (and vice versa). Loading each body
// here also proves the chunk imports cleanly under node.

import { describe, expect, it } from "vitest";
import {
  SURFACE_CATALOG,
  SURFACE_SUBCATEGORIES,
  SURFACE_SUBJECTS,
  SURFACE_VOLUMES,
  isSurfaceOutOfScope,
  isSurfaceShowcased,
  surfaceRecord,
} from "@/lib/org/surface-catalog";
import { SURFACE_BODIES } from "./surfaceBodies";

const DIGEST = /^sha256:[0-9a-f]{16,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("SURFACE_SUBJECTS — the static mirror of the ui-surfaces branch", () => {
  it("lists all 33 subjects with unique slugs in the five subcategories", () => {
    expect(SURFACE_SUBJECTS).toHaveLength(33);
    expect(new Set(SURFACE_SUBJECTS.map((s) => s.slug)).size).toBe(33);
    const subs = new Set(SURFACE_SUBCATEGORIES.map((c) => c.id));
    for (const s of SURFACE_SUBJECTS) expect(subs.has(s.subcategory), s.slug).toBe(true);
    expect(SURFACE_SUBJECTS.filter((s) => s.subcategory === "input-and-editing")).toHaveLength(8);
  });

  it("marks exactly the input-and-editing subjects out of scope (per .ai/manifest.yaml)", () => {
    for (const s of SURFACE_SUBJECTS) expect(isSurfaceOutOfScope(s.slug)).toBe(s.subcategory === "input-and-editing");
    expect(isSurfaceOutOfScope("nope")).toBe(false);
  });

  it("offers the three fixture volumes", () => {
    expect([...SURFACE_VOLUMES]).toEqual([50, 5_000, 50_000]);
  });
});

describe("SURFACE_CATALOG ⇄ SURFACE_BODIES", () => {
  it("every record has a body and every body has a record", () => {
    expect(SURFACE_CATALOG.map((r) => r.slug).sort()).toEqual(Object.keys(SURFACE_BODIES).sort());
  });

  it("record slugs are unique, real subjects, and carry their subject's subcategory", () => {
    expect(new Set(SURFACE_CATALOG.map((r) => r.slug)).size).toBe(SURFACE_CATALOG.length);
    for (const r of SURFACE_CATALOG) {
      const subject = SURFACE_SUBJECTS.find((s) => s.slug === r.slug);
      expect(subject, `${r.slug} is not a ui-surfaces subject`).toBeTruthy();
      expect(r.subcategory).toBe(subject?.subcategory);
      expect(r.authoredAgainst.digest).toMatch(DIGEST);
      expect(r.authoredAgainst.verifiedOn).toMatch(DATE);
      expect(r.summary.length).toBeGreaterThan(20);
      expect(new Set(r.techniqueSlugs).size).toBe(r.techniqueSlugs.length);
    }
  });

  it("the lookups agree with the catalog", () => {
    for (const r of SURFACE_CATALOG) {
      expect(isSurfaceShowcased(r.slug)).toBe(true);
      expect(surfaceRecord(r.slug)).toBe(r);
    }
    expect(isSurfaceShowcased("table")).toBe(false);
    expect(surfaceRecord("table")).toBeNull();
  });

  it("every record's techniqueSlugs ⇄ its body's techniques, and every technique is complete", async () => {
    for (const r of SURFACE_CATALOG) {
      const body = await SURFACE_BODIES[r.slug]();
      expect(typeof body.Scene).toBe("function");
      expect(body.techniques.map((t) => t.slug).sort()).toEqual([...r.techniqueSlugs].sort());
      for (const t of body.techniques) {
        expect(t.title.length, `${r.slug}/${t.slug} title`).toBeGreaterThan(0);
        expect(t.mechanism.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 1).length, `${r.slug}/${t.slug} mechanism sentences`).toBeGreaterThanOrEqual(3);
        expect(t.source.trim().length, `${r.slug}/${t.slug} source`).toBeGreaterThan(20);
        if (t.inAscent) expect(t.inAscent.file).toMatch(/^src\//);
      }
    }
  });
});
