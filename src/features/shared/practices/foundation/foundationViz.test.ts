// The rollout matrix's encodings, pinned without a DOM.
//
// Each case below is a sentence the panel used to print, now asserted as a STATE — which is the
// point of the redesign: a caption can be true and ignored, a state cannot be printed wrong.

import { describe, it, expect } from "vitest";
import { rendersValue } from "@/components/shared/viz";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { FOUNDATION_AXES, FOUNDATION_GRID_ROWS, foundationViz } from "./foundationViz";
import { foundationBackMark, reportBackAction } from "./foundationMarks";

const row = (over: Partial<FoundationRolloutRow> & { repo: string }): FoundationRolloutRow => ({
  foundationPrAt: null,
  reportBackAt: null,
  conformance: null,
  conformanceAt: null,
  ...over,
});

const cellsOf = (rows: ReturnType<typeof foundationViz>["rows"], repo: string) =>
  rows.find((r) => r.id === repo)!.cells;

describe("axes", () => {
  it("names the rollout stages in order", () => {
    expect([...FOUNDATION_AXES]).toEqual(["PR", "Report-back", "Conformance"]);
  });
});

describe("state per cell", () => {
  it("an opened (draft) PR is DECLARED, never measured", () => {
    const viz = foundationViz([row({ repo: "a/x", foundationPrAt: "2026-08-01T00:00:00.000Z" })]);
    expect(cellsOf(viz.rows, "a/x")[0]).toEqual({ state: "declared" });
  });

  it("no Ascent PR is NOT-JUDGED — a hand-committed .ai/ is unobservable, not absent", () => {
    const viz = foundationViz([row({ repo: "a/x" })]);
    expect(cellsOf(viz.rows, "a/x")[0]).toEqual({ state: "not-judged" });
    expect(rendersValue("not-judged")).toBe(false);
  });

  it("provisioned report-back is MEASURED (Ascent wrote the secrets itself)", () => {
    const viz = foundationViz([row({ repo: "a/x", reportBackAt: "2026-08-02T00:00:00.000Z" })]);
    expect(cellsOf(viz.rows, "a/x")[1]).toEqual({ state: "measured" });
  });

  it("un-provisioned report-back is a VOID — 'not provisioned' is not 'off'", () => {
    const viz = foundationViz([row({ repo: "a/x" })]);
    expect(cellsOf(viz.rows, "a/x")[1]).toEqual({ state: "missing" });
    expect(rendersValue("missing")).toBe(false);
  });

  it("a reported conformance carries its score; a never-reported one is a void, never 0", () => {
    const viz = foundationViz([row({ repo: "a/x", conformance: 0 }), row({ repo: "a/y" })]);
    // A genuine 0% IS a measurement and keeps its numeral.
    expect(cellsOf(viz.rows, "a/x")[2]).toEqual({ state: "measured", score: 0 });
    expect(cellsOf(viz.rows, "a/y")[2]).toEqual({ state: "missing" });
  });
});

describe("ordering and overflow", () => {
  it("puts the least-covered repo first, then unwired, then silent, then the weakest report", () => {
    const viz = foundationViz([
      row({ repo: "a/reported", foundationPrAt: "i", reportBackAt: "p", conformance: 90 }),
      row({ repo: "a/silent", foundationPrAt: "i", reportBackAt: "p" }),
      row({ repo: "a/unwired", foundationPrAt: "i" }),
      row({ repo: "a/nothing" }),
    ]);
    expect(viz.rows.map((r) => r.id)).toEqual(["a/nothing", "a/unwired", "a/silent", "a/reported"]);
  });

  it("breaks a tie among reporters by the weakest conformance", () => {
    const viz = foundationViz([
      row({ repo: "a/high", foundationPrAt: "i", reportBackAt: "p", conformance: 91 }),
      row({ repo: "a/low", foundationPrAt: "i", reportBackAt: "p", conformance: 12 }),
    ]);
    expect(viz.rows.map((r) => r.id)).toEqual(["a/low", "a/high"]);
  });

  it("draws at most FOUNDATION_GRID_ROWS repos and counts the rest for the table below", () => {
    const many = Array.from({ length: FOUNDATION_GRID_ROWS + 5 }, (_, i) => row({ repo: `a/r${i}` }));
    const viz = foundationViz(many);
    expect(viz.rows).toHaveLength(FOUNDATION_GRID_ROWS);
    expect(viz.overflow).toBe(5);
  });
});

describe("legend contract", () => {
  it("lists only the states the drawn rows actually contain, in kit order", () => {
    const viz = foundationViz([row({ repo: "a/x", foundationPrAt: "i", conformance: 40 })]);
    expect(viz.states).toEqual(["measured", "declared", "missing"]);
  });
});

describe("fleet counts", () => {
  it("counts declarations, provisioning and reports separately", () => {
    const viz = foundationViz([
      row({ repo: "a/x", foundationPrAt: "i", reportBackAt: "p", conformance: 70 }),
      row({ repo: "a/y", foundationPrAt: "i" }),
      row({ repo: "a/z" }),
    ]);
    expect(viz).toMatchObject({ declared: 2, provisioned: 1, reporting: 1, unjudged: 1 });
  });
});

describe("report-back credential states", () => {
  const at = "2026-08-02T00:00:00.000Z";
  const st = (repo: string, state: string, extra: Record<string, unknown> = {}) =>
    row({ repo, reportBackAt: state === "live" || state === "legacy-shared" ? at : null, reportBack: { state, ...extra } as never });

  it("'provisioned' counts only live credentials", () => {
    const viz = foundationViz([st("a/l", "live"), st("a/s", "legacy-shared"), st("a/f", "failed"), st("a/r", "credential-revoked")]);
    expect(viz.provisioned).toBe(1);
    expect(cellsOf(viz.rows, "a/l")[1]).toEqual({ state: "measured" });
    expect(cellsOf(viz.rows, "a/r")[1]).toEqual({ state: "missing" });
  });

  it("each state reads as its own word, and none prints an em dash", () => {
    expect(foundationBackMark(st("a/r", "credential-revoked"))).toEqual({ state: "missing", word: "Credential revoked" });
    expect(foundationBackMark(st("a/f", "failed", { reason: "missing-permission" }))).toEqual({ state: "missing", word: "Failed" });
    expect(foundationBackMark(st("a/s", "legacy-shared"))).toEqual({ state: "partial", word: "Legacy shared" });
    expect(foundationBackMark(st("a/l", "live"))).toEqual({ state: "met", word: "Provisioned" });
    for (const s of ["live", "failed", "credential-revoked", "legacy-shared", "none"]) {
      expect(JSON.stringify([foundationBackMark(st("a/x", s)), reportBackAction(st("a/x", s))])).not.toContain("\u2014");
    }
  });

  it("offers the one action that fits the state", () => {
    expect(reportBackAction(st("a/r", "credential-revoked"))).toEqual({ kind: "provision", label: "Re-provision" });
    expect(reportBackAction(st("a/s", "legacy-shared"))).toEqual({ kind: "provision", label: "Re-provision" });
    expect(reportBackAction(st("a/l", "live"))).toEqual({ kind: "revoke", label: "Remove" });
    expect(reportBackAction(st("a/f", "failed", { reason: "missing-permission", configureUrl: "https://github.com/settings/installations/1" }))).toEqual({
      kind: "configure",
      label: "Grant Secrets write",
      href: "https://github.com/settings/installations/1",
    });
    expect(reportBackAction(st("a/f", "failed", { reason: "write-failed" }))).toEqual({ kind: "provision", label: "Retry" });
    expect(reportBackAction(row({ repo: "a/n" }))).toEqual({ kind: "provision", label: "Set up report-back" });
  });
});
