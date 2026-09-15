// The CI wrapper's half of the skip channel (`scripts/maturity-gate.mjs`).
//
// The script advertises `--require-protection`, `--min-ai-governed` and `--no-ungoverned-ai` in its
// own usage block, and on the endpoint it calls those three can never be evaluated — the scan is
// token-less by construction. So the operator who passes them gets exit 0 and a green line, and
// nothing anywhere says the bar was not tested. These pin the formatter that fixes that.
//
// Importing the CLI is only safe because the script guards its `main()` behind an
// "invoked directly" check; if that guard is removed this file will hang or exit the test process,
// which is a loud failure rather than a silent one.

import { describe, it, expect } from "vitest";
// @ts-expect-error — a plain .mjs CLI with no type declarations; the shape is asserted below.
import { formatSkipped, skippedCodes } from "../../../scripts/maturity-gate.mjs";

const skips = [
  { code: "governance", why: "Branch protection was NOT READ on this scan, so the rule was not tested." },
  { code: "provenance", why: "Pull-request signals were NOT MEASURED on this scan." },
];

describe("maturity-gate CLI — printing what was not measured", () => {
  it("prints one line per skipped criterion, with its reason", () => {
    const lines = formatSkipped(skips).join("\n");
    expect(lines).toContain("NOT MEASURED on this run");
    expect(lines).toContain("- governance: Branch protection was NOT READ");
    expect(lines).toContain("- provenance: Pull-request signals were NOT MEASURED");
    // The sentence that stops a reader treating a skip as a satisfied bar.
    expect(lines).toContain("A skipped condition is not a pass");
  });

  it("prints NOTHING when every condition was measured — no noise on a clean run", () => {
    expect(formatSkipped([])).toEqual([]);
    expect(formatSkipped(undefined)).toEqual([]);
  });

  it("survives a malformed body rather than crashing the step", () => {
    // The body is a network response; a wrapper that throws while REPORTING a verdict would turn a
    // pass into an unexplained non-zero exit.
    expect(formatSkipped("nope")).toEqual([]);
    expect(formatSkipped([null, { code: "control" }]).join("\n")).toContain("- control: no reason given");
  });

  it("reduces the codes to a deduped single-line scalar for the `skipped` step output", () => {
    // $GITHUB_OUTPUT's plain `key=value` form is line-based: a multi-line value corrupts the file.
    const value = skippedCodes([...skips, { code: "governance", why: "again" }]);
    expect(value).toBe("governance,provenance");
    expect(value).not.toContain("\n");
    expect(skippedCodes(undefined)).toBe("");
  });
});
