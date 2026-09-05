// Pure tests for the `signals/` lane (#18). The rule the whole lane rests on is that a count nobody
// reported is NULL, not zero — a subject with `consults: 0` reads as "nobody reached for this", which
// is an argument for deleting it, and getting that wrong deletes good knowledge.

import { describe, expect, it } from "vitest";
import { aggregateSignals, summarizeSignals } from "./signals";
import { SIGNALS_SCHEMA } from "./layout";

const file = (path: string, doc: unknown) => ({ path, text: JSON.stringify(doc) });

const contribution = (subjects: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  schema: SIGNALS_SCHEMA,
  app: "ascent",
  generatedAt: "2026-08-29T12:00:00Z",
  windowDays: 30,
  bundles: { "software-engineering": { subjects } },
  ...over,
});

describe("aggregateSignals", () => {
  it("reads consults and deviations per subject", () => {
    const { rows, contributors } = aggregateSignals(
      [file("signals/dev-box.json", contribution({ "quality-gates": { consults: 12, deviations: 2 } }))],
      [],
    );
    expect(contributors).toBe(1);
    expect(rows).toEqual([
      {
        contributor: "dev-box",
        app: "ascent",
        bundle: "software-engineering",
        subjectSlug: "quality-gates",
        consults: 12,
        deviations: 2,
        citResolved: null,
        citMoved: null,
        citGone: null,
        windowDays: 30,
        generatedAt: "2026-08-29T12:00:00Z",
      },
    ]);
  });

  it("leaves citation counts NULL when the contributor ran no citation check", () => {
    // Not 0. "All the pointers resolve" and "nobody looked" are different claims about the corpus.
    const { rows } = aggregateSignals(
      [file("signals/a.json", contribution({ s: { consults: 3 } }))],
      [],
    );
    expect(rows[0]).toMatchObject({ citResolved: null, citMoved: null, citGone: null, deviations: null });
  });

  it("keeps a reported ZERO as zero", () => {
    const { rows } = aggregateSignals(
      [file("signals/a.json", contribution({ s: { consults: 0, citations: { resolved: 0, moved: 0, gone: 0 } } }))],
      [],
    );
    expect(rows[0]).toMatchObject({ consults: 0, citResolved: 0, citMoved: 0, citGone: 0 });
  });

  it("skips a file whose schema is not this lane's", () => {
    const warnings: string[] = [];
    const { rows, contributors } = aggregateSignals(
      [file("signals/a.json", contribution({ s: { consults: 1 } }, { schema: "rkb-signals/2" }))],
      warnings,
    );
    expect(rows).toEqual([]);
    expect(contributors).toBe(0);
    expect(warnings[0]).toContain(`schema is not ${SIGNALS_SCHEMA}`);
  });

  it("degrades ONE malformed contribution, never the pass", () => {
    const warnings: string[] = [];
    const { rows, contributors } = aggregateSignals(
      [
        { path: "signals/broken.json", text: "{oops" },
        file("signals/good.json", contribution({ s: { consults: 1 } })),
      ],
      warnings,
    );
    expect(rows).toHaveLength(1);
    expect(contributors).toBe(1);
    expect(warnings).toEqual(["signals/broken.json: not valid JSON — signals skipped"]);
  });

  it("does not let two contributors collide", () => {
    const { rows, contributors } = aggregateSignals(
      [
        file("signals/a.json", contribution({ s: { consults: 1 } })),
        file("signals/b.json", contribution({ s: { consults: 4 } })),
      ],
      [],
    );
    expect(contributors).toBe(2);
    expect(rows.map((r) => [r.contributor, r.consults])).toEqual([
      ["a", 1],
      ["b", 4],
    ]);
  });

  it("takes the contributor from the file stem, not the document's claim", () => {
    const { rows } = aggregateSignals(
      [file("signals/real-stem.json", contribution({ s: { consults: 1 } }, { contributor: "i-am-someone-else" }))],
      [],
    );
    expect(rows[0]!.contributor).toBe("real-stem");
  });

  it("warns and skips a bundle with no subjects object", () => {
    const warnings: string[] = [];
    const { rows } = aggregateSignals(
      [file("signals/a.json", { schema: SIGNALS_SCHEMA, bundles: { se: { subjects: 4 } } })],
      warnings,
    );
    expect(rows).toEqual([]);
    expect(warnings[0]).toContain("has no subjects object");
  });

  it("defaults windowDays rather than dropping a file that omitted it", () => {
    const { rows } = aggregateSignals(
      [file("signals/a.json", contribution({ s: { consults: 1 } }, { windowDays: "thirty" }))],
      [],
    );
    expect(rows[0]!.windowDays).toBe(30);
  });
});

describe("summarizeSignals", () => {
  const row = (over: Partial<Parameters<typeof summarizeSignals>[0][number]>) => ({
    contributor: "a",
    app: null,
    bundle: "se",
    subjectSlug: "quality-gates",
    consults: null,
    deviations: null,
    citResolved: null,
    citMoved: null,
    citGone: null,
    windowDays: 30,
    generatedAt: "2026-08-29T00:00:00Z",
    ...over,
  });

  it("sums across contributors and carries how many reported", () => {
    const out = summarizeSignals([
      row({ contributor: "a", consults: 3, deviations: 1 }),
      row({ contributor: "b", consults: 4 }),
    ]);
    expect(out).toEqual([
      {
        bundle: "se",
        subjectSlug: "quality-gates",
        contributors: 2,
        consults: 7,
        // Only one contributor measured deviations; the sum is over that one, and `contributors`
        // is what tells the reader the evidence is thin.
        deviations: 1,
        citResolved: null,
        citMoved: null,
        citGone: null,
      },
    ]);
  });

  it("keeps a key NULL when NO contributor reported it", () => {
    const out = summarizeSignals([row({ consults: 1 }), row({ contributor: "b", consults: 2 })]);
    expect(out[0]!.deviations).toBeNull();
    expect(out[0]!.citGone).toBeNull();
  });

  it("separates subjects", () => {
    const out = summarizeSignals([row({ consults: 1 }), row({ subjectSlug: "hitl-approval", consults: 9 })]);
    expect(out.map((s) => [s.subjectSlug, s.consults])).toEqual([
      ["quality-gates", 1],
      ["hitl-approval", 9],
    ]);
  });
});
