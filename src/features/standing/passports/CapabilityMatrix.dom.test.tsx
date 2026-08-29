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
});
