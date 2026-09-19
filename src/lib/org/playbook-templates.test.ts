// Pins the create-time seed: fromDim/fromRec fill from PLAYBOOK_TEMPLATES, never from invented steps.
// The route test covers HTTP; this covers the mapping the form and POST both use.

import { describe, expect, it } from "vitest";
import { PLAYBOOK_TEMPLATES, seedPlaybookCreate } from "./playbook-templates";

const d5 = PLAYBOOK_TEMPLATES.find((t) => t.dimId === "D5");
if (!d5) throw new Error("D5 template missing — PLAYBOOK_TEMPLATES must stay 1:1 with PRACTICES");

describe("seedPlaybookCreate — fromDim", () => {
  it("fills title/dimId/steps from the D5 template when only fromDim is set", () => {
    const out = seedPlaybookCreate({ fromDim: "D5" });
    expect(out).toEqual({
      ok: true,
      input: { title: d5.title, dimId: "D5", summary: d5.summary, steps: d5.steps },
    });
  });

  it("400s an unknown dim instead of inventing a starter", () => {
    expect(seedPlaybookCreate({ fromDim: "D99" })).toEqual({
      ok: false,
      error: "dimId must be D1..D9.",
    });
  });

  it("lets an explicit title override the template, keeping template steps", () => {
    const out = seedPlaybookCreate({ fromDim: "D5", title: "Our ADR standard" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.title).toBe("Our ADR standard");
    expect(out.input.steps).toEqual(d5.steps);
  });
});

describe("seedPlaybookCreate — fromRec (briefing ranked next move)", () => {
  const rec = { title: "Add ADRs to the 8 repos missing them", dimId: "D5" };

  it("takes the rec title + dim and the matching template's steps — never rec.explore", () => {
    const out = seedPlaybookCreate({ fromRec: true }, rec);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.title).toBe(rec.title);
    expect(out.input.dimId).toBe("D5");
    expect(out.input.summary).toBe(d5.summary);
    expect(out.input.steps).toEqual(d5.steps);
    expect(out.input.steps).not.toContain("invented");
  });

  it("fails closed when the briefing has no ranked next move", () => {
    expect(seedPlaybookCreate({ fromRec: true }, null)).toEqual({
      ok: false,
      error: "No ranked next move to seed from.",
    });
  });

  it("400s when the rec's dim has no template", () => {
    expect(seedPlaybookCreate({ fromRec: true }, { title: "X", dimId: "DX" })).toEqual({
      ok: false,
      error: "dimId must be D1..D9.",
    });
  });
});

describe("seedPlaybookCreate — unseeded", () => {
  it("still rejects a blank title", () => {
    expect(seedPlaybookCreate({ title: "  ", dimId: "D5" })).toEqual({
      ok: false,
      error: "Provide { org, title, dimId }.",
    });
  });

  it("passes an explicit title+dimId through", () => {
    const out = seedPlaybookCreate({ title: "Ours", dimId: "D3", summary: "s", steps: ["a"] });
    expect(out).toEqual({
      ok: true,
      input: { title: "Ours", dimId: "D3", summary: "s", steps: ["a"] },
    });
  });
});
