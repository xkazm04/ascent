// The one judgement call in the governance matrix: a branch rule that requires a pull request but
// zero approving reviews is DECLARED, not enforced.
//
// A tick column can only report that the repo requires a PR (✓), which reads as governed; in fact the
// author merges their own work. `declared` — dashed outline, no fill — is the state the /org
// vocabulary reserves for exactly that, and this pins that the mapping cannot quietly regress to a
// green tick or to an "off" that understates what is configured.

import { describe, expect, it } from "vitest";
import type { RepoGovernance } from "@/lib/db";
import { GAP_MATRIX_ROWS, governanceGapRows } from "./governanceGaps";

const repo = (over: Partial<RepoGovernance> = {}): RepoGovernance =>
  ({
    fullName: "acme/web",
    name: "web",
    protected: true,
    requiresPullRequest: true,
    requiredApprovals: 1,
    requiresStatusChecks: true,
    requiresSignatures: false,
    ruleCount: 3,
    ...over,
  }) as RepoGovernance;

describe("governanceGapRows", () => {
  it("marks a PR rule with zero required approvals as declared, not enforced", () => {
    const [row] = governanceGapRows([repo({ requiredApprovals: 0 })]);
    expect(row!.cells[1]).toEqual({ state: "declared", on: false });
  });

  it("marks a repo that requires no pull request at all as a measured OFF", () => {
    const [row] = governanceGapRows([repo({ requiresPullRequest: false, requiredApprovals: 0 })]);
    expect(row!.cells[1]).toEqual({ state: "measured", on: false });
  });

  it("marks an enforced review requirement as measured ON", () => {
    const [row] = governanceGapRows([repo({ requiredApprovals: 2 })]);
    expect(row!.cells[1]).toEqual({ state: "measured", on: true });
  });

  it("reports the other three controls as measured booleans, never as absences", () => {
    const [row] = governanceGapRows([repo({ protected: false, requiresStatusChecks: false, requiresSignatures: true })]);
    expect(row!.cells[0]).toEqual({ state: "measured", on: false });
    expect(row!.cells[2]).toEqual({ state: "measured", on: false });
    expect(row!.cells[3]).toEqual({ state: "measured", on: true });
  });

  it("caps the headline graphic and leaves the tail to the table below it", () => {
    const many = Array.from({ length: GAP_MATRIX_ROWS + 5 }, (_, i) => repo({ fullName: `acme/r${i}`, name: `r${i}` }));
    expect(governanceGapRows(many)).toHaveLength(GAP_MATRIX_ROWS);
    expect(governanceGapRows(many, 3)).toHaveLength(3);
  });
});
