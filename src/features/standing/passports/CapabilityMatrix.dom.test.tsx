// @vitest-environment jsdom
//
// #13 render half. The aggregation keeps unassessed repos out of the denominators; this asserts the
// VIEW does not put them back — the failure mode is a table that renders every repo uniformly and
// quietly turns "we never read this repo's manifest" into a `0/0` that looks like a measurement.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ManifestReadout } from "@/lib/standard/readout";
import type { CapabilityMatrixInput } from "./capabilityAgg";

const { CapabilityMatrix } = await import("./CapabilityMatrix");

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

describe("CapabilityMatrix", () => {
  it("renders the not-assessed band for a repo with no readout, and never a 0/0 for it", () => {
    render(<CapabilityMatrix repos={[repo("acme/read", readout()), repo("acme/unread", null)]} />);
    expect(screen.getByText(/not assessed — re-scan/i)).toBeTruthy();
    expect(screen.getByText(/acme\/unread/)).toBeTruthy();
    expect(screen.queryByText("0/0")).toBeNull();
    // The measured repo still shows its real ratio.
    expect(screen.getAllByText("1/2").length).toBeGreaterThan(0);
  });

  it("shows an em dash, not 0%, when NOTHING in the fleet was assessed", () => {
    render(<CapabilityMatrix repos={[repo("acme/a", null), repo("acme/b", null)]} />);
    expect(screen.getByText(/no manifest read yet/i)).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText(/has had its/i)).toBeTruthy();
  });

  it("decodes every cell state it can render, so the table is readable without guessing", () => {
    render(<CapabilityMatrix repos={[repo("acme/read", readout())]} />);
    for (const state of ["verified", "declared", "placeholder", "absent"])
      expect(screen.getByText(state, { exact: true })).toBeTruthy();
    expect(screen.getByText(/enforced pre-push/i)).toBeTruthy();
    expect(screen.getAllByText(/CI hard pass/i).length).toBeGreaterThan(0);
  });

  // UAT `PRIYA-L1-04`. Spec #13 promised a manifest on an unknown major would be "parsed leniently,
  // flagged honestly". It was computed (`read.ts`), persisted (`readout.ts`) and rendered by nothing:
  // a fleet on a newer schema showed ordinary cells with no hint the reader was behind.
  it("flags a manifest whose schema major this build does not know", () => {
    render(<CapabilityMatrix repos={[repo("acme/ahead", readout({ schemaVersion: "1.0.0", schemaAhead: true }))]} />);
    expect(screen.getByText(/schema 1\.0\.0 ahead/i)).toBeTruthy();
  });

  it("surfaces the reader's parse notes — the REDACTION half an operator could not otherwise see", () => {
    render(
      <CapabilityMatrix
        repos={[repo("acme/red", readout({ notes: ["1 capability command(s) contained a secret-shaped run and were redacted"] }))]}
      />,
    );
    expect(screen.getByText(/1 parse note/i)).toBeTruthy();
  });

  it("says nothing about schema or notes for an ordinary manifest", () => {
    render(<CapabilityMatrix repos={[repo("acme/plain", readout())]} />);
    expect(screen.queryByText(/ahead/i)).toBeNull();
    expect(screen.queryByText(/parse note/i)).toBeNull();
  });

  // UAT `PRIYA-L1-05` — spec #35 handoff 2's promised report-back column. `getFoundationRollout` had
  // one consumer, on a different tab, so the join lived in the reader's head.
  describe("the report-back column", () => {
    const rollout = (over: Partial<{ repo: string; foundationPrAt: string | null; reportBackAt: string | null; conformance: number | null; conformanceAt: string | null }>) => ({
      repo: "acme/read",
      foundationPrAt: null,
      reportBackAt: null,
      conformance: null,
      conformanceAt: null,
      ...over,
    });

    it("prints the reported percentage where one exists", () => {
      render(
        <CapabilityMatrix
          repos={[repo("acme/read", readout())]}
          rollout={[rollout({ reportBackAt: "2026-08-01T00:00:00.000Z", conformance: 92, conformanceAt: "2026-08-30T00:00:00.000Z" })]}
        />,
      );
      expect(screen.getByText("92%")).toBeTruthy();
    });

    it("keeps the two honest nulls apart — never reported is not 0%, not provisioned is not off", () => {
      render(
        <CapabilityMatrix
          repos={[repo("acme/read", readout())]}
          rollout={[rollout({ reportBackAt: "2026-08-01T00:00:00.000Z" })]}
        />,
      );
      expect(screen.getByText(/never reported/i)).toBeTruthy();
      expect(screen.queryByText("0%")).toBeNull();
    });

    it("says 'not provisioned' where Ascent wrote no secrets", () => {
      render(<CapabilityMatrix repos={[repo("acme/read", readout())]} rollout={[rollout({})]} />);
      expect(screen.getByText(/not provisioned/i)).toBeTruthy();
    });
  });
});
