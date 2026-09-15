// The declared × observed × enforced grid that replaced the panel's 175-character lede. What is
// asserted here is the part a sentence could never enforce: which cells are allowed to carry a number.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import { buildCapabilityMatrix, type CapabilityMatrixInput } from "./capabilityAgg";
import { CAPABILITY_AXES, capabilityVizRows, capabilityVizStates } from "./capabilityViz";
import type { ManifestReadout } from "@/lib/standard/readout";

type Cap = ManifestReadout["capabilities"][number];

function readout(capabilities: Cap[]): ManifestReadout {
  return {
    status: "ok",
    readAt: "2026-06-10T00:00:00.000Z",
    generatedAt: "2026-06-01",
    schemaVersion: "0.3.0",
    schemaAhead: false,
    capabilities,
    controls: { prePush: [], ciHardPass: [] },
    paths: {},
    agents: [],
    purpose: null,
    boundaries: { neverTouch: [], secretsFrom: null },
    placeholders: [],
    unbacked: [],
    notes: [],
  };
}

const cap = (name: string, over: Partial<Cap> = {}): Cap => ({
  name,
  command: `npm run ${name}`,
  verified: null,
  placeholder: false,
  wiredAt: [],
  ...over,
});

const repo = (fullName: string, capabilities: Cap[] | null): CapabilityMatrixInput => ({
  fullName,
  name: fullName.split("/")[1]!,
  manifest: capabilities ? readout(capabilities) : null,
});

const rowFor = (repos: CapabilityMatrixInput[], name: string) =>
  capabilityVizRows(buildCapabilityMatrix(repos)).find((r) => r.id === name)!;

describe("capabilityVizRows", () => {
  it("draws the three axes the deleted sentence named", () => {
    expect([...CAPABILITY_AXES]).toEqual(["Declared", "Proven", "Enforced"]);
  });

  it("keeps the Declared axis a declaration, never a measurement", () => {
    const r = rowFor([repo("acme/a", [cap("test")])], "test");
    expect(r.cells[0]).toEqual({ state: "declared", score: 100 });
  });

  it("hatches Proven — with no number — when no doctor has judged the capability", () => {
    const r = rowFor([repo("acme/a", [cap("test")]), repo("acme/b", [cap("test")])], "test");
    expect(r.cells[1]!.state).toBe("not-judged");
    expect(r.cells[1]!.score).toBeUndefined();
    expect(rendersValue(r.cells[1]!.state)).toBe(false);
  });

  it("measures Proven as the share of DECLARING repos once any doctor has run it", () => {
    const r = rowFor([repo("acme/a", [cap("test", { verified: true })]), repo("acme/b", [cap("test")])], "test");
    expect(r.cells[1]).toEqual({ state: "measured", score: 50 });
  });

  it("counts a FAILED run as judged — it is evidence, and it is not a pass", () => {
    const r = rowFor([repo("acme/a", [cap("test", { verified: false })])], "test");
    expect(r.cells[1]).toEqual({ state: "measured", score: 0 });
  });

  it("voids Proven and Enforced for a capability no assessed repo declares — never a zero", () => {
    const r = rowFor([repo("acme/a", [cap("test")])], "build");
    expect(r.cells[0]).toEqual({ state: "declared", score: 0 });
    expect(r.cells[1]).toEqual({ state: "missing" });
    expect(r.cells[2]).toEqual({ state: "missing" });
  });

  it("treats a measured Enforced zero as real — the controls block WAS read", () => {
    const r = rowFor([repo("acme/a", [cap("test", { verified: true })])], "test");
    expect(r.cells[2]).toEqual({ state: "measured", score: 0 });
  });

  it("counts either placement as enforced", () => {
    const r = rowFor(
      [repo("acme/a", [cap("test", { wiredAt: ["prePush"] })]), repo("acme/b", [cap("test", { wiredAt: ["ciHardPass"] })])],
      "test",
    );
    expect(r.cells[2]).toEqual({ state: "measured", score: 100 });
  });

  it("keeps an unassessed repo out of every denominator, exactly as the aggregation does", () => {
    const r = rowFor([repo("acme/a", [cap("test")]), repo("acme/never-read", null)], "test");
    // 100%, not 50%: the repo whose manifest was never read is not in the base.
    expect(r.cells[0]!.score).toBe(100);
  });

  it("lists only the states present, in kit order", () => {
    const rows = capabilityVizRows(buildCapabilityMatrix([repo("acme/a", [cap("test", { verified: true })])]));
    expect(capabilityVizStates(rows)).toEqual(["measured", "declared", "missing"]);
  });
});
