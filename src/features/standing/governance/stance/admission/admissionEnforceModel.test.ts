// The pure half of the per-row Enforce panel (moonshot #8 follow-up "proposal dry-run modal UI").
// Which compiled controls a row may open, and the typed-confirm comparison the ruleset route makes.

import { describe, expect, it } from "vitest";
import type { AdmissionView } from "./admissionRows";
import { enforceActions, parseOwners, previewDigest, typedConfirmReady } from "./admissionEnforceModel";
import { artifactFingerprint } from "@/lib/practices/fingerprint";

const view = (over: Partial<AdmissionView> = {}): AdmissionView => ({
  fullName: "xkazm04/kp",
  name: "kp",
  mode: "assisted-only",
  tier: "T1",
  decided: true,
  decidedBy: "priya",
  overridesDerived: null,
  stale: false,
  rulesetId: null,
  unassessed: false,
  ...over,
});

describe("enforceActions", () => {
  it("an unassessed tier compiles nothing: no CODEOWNERS proposal, no ruleset", () => {
    const a = enforceActions(view({ tier: null, unassessed: true, decided: false, decidedBy: null }));
    expect(a.codeowners).toEqual({ available: false, reason: "tier not assessed" });
    expect(a.ruleset).toBe("none");
  });

  it("an applied ruleset offers revert and never a second apply", () => {
    const a = enforceActions(view({ rulesetId: "42" }));
    expect(a.ruleset).toBe("revert");
    expect(a.ruleset).not.toBe("apply");
  });

  it("an assessed row with no ruleset offers apply", () => {
    const a = enforceActions(view({ tier: "T1", rulesetId: null }));
    expect(a.ruleset).toBe("apply");
    expect(a.codeowners).toEqual({ available: true });
  });

  it("a tier that compiles no ruleset (T3, agents allowed) offers none, with the reason", () => {
    const a = enforceActions(view({ tier: "T3", mode: "agents-allowed" }));
    expect(a.ruleset).toBe("none");
    expect(a.rulesetReason).toMatch(/compile no ruleset/);
  });

  it("guard: a stored ruleset stays revertable even where the tier was never assessed", () => {
    expect(enforceActions(view({ tier: null, rulesetId: "7" })).ruleset).toBe("revert");
  });
});

describe("typedConfirmReady", () => {
  it("is the literal the route compares: case matters", () => {
    expect(typedConfirmReady("xkazm04/KP", "xkazm04/kp")).toBe(false);
    expect(typedConfirmReady("xkazm04/kp", "xkazm04/kp")).toBe(true);
    expect(typedConfirmReady(" xkazm04/kp", "xkazm04/kp")).toBe(false);
  });
});

describe("parseOwners / previewDigest", () => {
  it("splits teams on commas and whitespace, dropping blanks and duplicates", () => {
    expect(parseOwners(" @acme/platform, @acme/sec  @acme/platform ")).toEqual(["@acme/platform", "@acme/sec"]);
    expect(parseOwners("   ")).toEqual([]);
  });

  it("digests the diff text exactly as the server's drift check does", () => {
    expect(previewDigest("+a\n-b")).toBe(artifactFingerprint("+a\n-b"));
  });
});
