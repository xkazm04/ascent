import { describe, expect, it } from "vitest";
import type { ManifestReadout } from "@/lib/standard/readout";
import { buildCapabilityMatrix, verifiedRatio, type CapabilityMatrixInput } from "./capabilityMatrix";

function readout(over: Partial<ManifestReadout> = {}): ManifestReadout {
  return {
    status: "ok",
    readAt: "2026-06-10T00:00:00.000Z",
    generatedAt: "2026-06-01",
    schemaVersion: "0.3.0",
    schemaAhead: false,
    capabilities: [
      { name: "test", command: "npm test", verified: true, placeholder: false, wiredAt: ["ciHardPass"] },
      { name: "lint", command: "npm run lint", verified: null, placeholder: false, wiredAt: ["prePush"] },
    ],
    controls: { prePush: ["lint"], ciHardPass: ["test"] },
    paths: {},
    agents: [],
    purpose: null,
    boundaries: { neverTouch: [], secretsFrom: null },
    placeholders: [],
    unbacked: [],
    notes: [],
    ...over,
  };
}

const repo = (fullName: string, manifest: ManifestReadout | null): CapabilityMatrixInput => ({
  fullName,
  name: fullName.split("/")[1]!,
  manifest,
});

describe("buildCapabilityMatrix", () => {
  it("counts declared vs proven per repo, and never counts an unassessed repo in a denominator", () => {
    const m = buildCapabilityMatrix([
      repo("acme/a", readout()),
      repo("acme/b", null), // never scanned for a manifest
      repo("acme/c", readout({ status: "unreadable", capabilities: [] })),
    ]);
    expect(m.rows.map((r) => r.fullName)).toEqual(["acme/a"]);
    expect(m.unassessed).toEqual([
      { fullName: "acme/b", name: "b", reason: "not assessed" },
      { fullName: "acme/c", name: "c", reason: "unreadable" },
    ]);
    expect(m.totals).toEqual({ repos: 1, declared: 2, verified: 1, wired: 2 });
    // THE assertion this module exists for: two of three repos are unmeasured, and the ratio is
    // over the one that was measured — not 1/6, and not a fleet "33% verified" nobody can act on.
    expect(verifiedRatio(m)).toBe(50);
  });

  it("returns a NULL ratio — never 0% — when nothing in the fleet was assessed", () => {
    const m = buildCapabilityMatrix([repo("acme/a", null), repo("acme/b", null)]);
    expect(m.rows).toEqual([]);
    expect(m.unassessed).toHaveLength(2);
    expect(verifiedRatio(m)).toBeNull();
  });

  it("orders columns: the recommended vocabulary first, then whatever a repo invented", () => {
    const m = buildCapabilityMatrix([
      repo(
        "acme/a",
        readout({
          capabilities: [
            { name: "fuzz", command: "make fuzz", verified: null, placeholder: false, wiredAt: [] },
            { name: "test", command: "npm test", verified: true, placeholder: false, wiredAt: [] },
            { name: "audit", command: "npm audit", verified: null, placeholder: false, wiredAt: [] },
          ],
        }),
      ),
    ]);
    expect(m.capabilities).toEqual(["build", "test", "lint", "typecheck", "audit", "fuzz"]);
  });

  it("a capability a repo does not declare is `absent`, not a failure", () => {
    const m = buildCapabilityMatrix([repo("acme/a", readout())]);
    const row = m.rows[0]!;
    expect(row.cells.build).toBeUndefined(); // the view renders a missing key as the absent cell
    expect(row.cells.test!.state).toBe("verified");
    expect(row.cells.lint!.state).toBe("declared");
    expect(row.cells.lint!.failed).toBe(false); // not run != ran and failed
  });

  it("separates a FAILED run from an un-run one, and a placeholder from both", () => {
    const m = buildCapabilityMatrix([
      repo(
        "acme/a",
        readout({
          capabilities: [
            { name: "test", command: "npm test", verified: false, placeholder: false, wiredAt: [] },
            { name: "build", command: "<your build command>", verified: null, placeholder: true, wiredAt: [] },
          ],
        }),
      ),
    ]);
    const cells = m.rows[0]!.cells;
    expect(cells.test!.state).toBe("declared");
    expect(cells.test!.failed).toBe(true);
    expect(cells.build!.state).toBe("placeholder");
    expect(m.rows[0]!.verified).toBe(0);
  });

  it("carries wiredAt and the unbacked controls through, and sorts most-proven first", () => {
    const m = buildCapabilityMatrix([
      repo("acme/quiet", readout({ capabilities: [], unbacked: ["scan-secrets"] })),
      repo("acme/loud", readout()),
    ]);
    expect(m.rows.map((r) => r.fullName)).toEqual(["acme/loud", "acme/quiet"]);
    expect(m.rows[0]!.cells.lint!.wiredAt).toEqual(["prePush"]);
    expect(m.rows[1]!.unbacked).toEqual(["scan-secrets"]);
    // A repo that declares a readable manifest with zero capabilities IS assessed — it is a repo
    // that declares nothing, which is a real (and reportable) state, unlike an unread one.
    expect(m.unassessed).toEqual([]);
    expect(m.rows[1]!.declared).toBe(0);
  });
});
