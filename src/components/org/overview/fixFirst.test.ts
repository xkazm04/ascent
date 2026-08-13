// Pins the Overview "Fix first" derivation: triage priority (regression > findings queue > behind
// goal), the busiest-findings-module pick, the cap at 3, and the href contracts each cell deep-links
// to (report permalink / module tab / plan tab), including scope carry.

import { describe, expect, it } from "vitest";
import { deriveFixFirst, type FixFirstInputs } from "@/components/org/overview/fixFirst";

const EMPTY: FixFirstInputs = { regressers: [], findings: [], goals: [] };

const FULL: FixFirstInputs = {
  regressers: [{ name: "api", fullName: "acme/api", dOverall: -9 }],
  findings: [
    { module: "security", repo: "acme/api", title: "Default branch is unprotected" },
    { module: "security", repo: "acme/web", title: "No dependency audit" },
    { module: "teams", repo: "acme/cli", title: "No owning team" },
  ],
  goals: [
    { label: "Reach L4", status: "active", pace: "behind" },
    { label: "Adoption 80", status: "active", pace: "on-pace" },
  ],
};

describe("deriveFixFirst — triage order, cap, and link contracts", () => {
  it("returns [] when nothing is actionable", () => {
    expect(deriveFixFirst("acme", EMPTY)).toEqual([]);
  });

  it("orders regression > finding > goal and caps at 3", () => {
    const items = deriveFixFirst("acme", FULL);
    expect(items.map((i) => i.key)).toEqual(["regression", "finding", "goal"]);
    expect(items).toHaveLength(3);
  });

  it("links each item to its evidence surface", () => {
    const items = deriveFixFirst("acme", FULL);
    expect(items[0]!.href).toBe("/report/acme/api");
    // security/plan are migrated tabs — orgTabHref resolves them to the `?tab=` shell.
    expect(items[1]!.href).toBe("/org/acme?tab=security");
    expect(items[2]!.href).toBe("/org/acme?tab=plan");
  });

  it("picks the busiest findings module and pluralizes the title", () => {
    const items = deriveFixFirst("acme", { ...EMPTY, findings: FULL.findings });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Decide 2 security findings");
    expect(items[0]!.detail).toContain("acme/api");
  });

  it("uses the singular form and the module tab for a lone finding", () => {
    const items = deriveFixFirst("acme", {
      ...EMPTY,
      findings: [{ module: "contributors", repo: "acme/cli", title: "Solo-maintained" }],
    });
    expect(items[0]!.title).toBe("Decide 1 contributor-risk finding");
    expect(items[0]!.href).toBe("/org/acme?tab=contributors");
  });

  it("breaks module ties in FINDING_MODULES order (security first)", () => {
    const items = deriveFixFirst("acme", {
      ...EMPTY,
      findings: [
        { module: "teams", repo: "acme/a", title: "t" },
        { module: "security", repo: "acme/b", title: "s" },
      ],
    });
    expect(items[0]!.href).toBe("/org/acme?tab=security");
  });

  it("ignores non-active or on-pace goals", () => {
    const items = deriveFixFirst("acme", {
      ...EMPTY,
      goals: [
        { label: "Old", status: "achieved", pace: "behind" },
        { label: "Fine", status: "active", pace: "on-pace" },
      ],
    });
    expect(items).toEqual([]);
  });

  it("carries the active scope into tab links but never into the report permalink", () => {
    const items = deriveFixFirst("acme", FULL, "stack=react");
    expect(items[0]!.href).toBe("/report/acme/api");
    expect(items[1]!.href).toBe("/org/acme?tab=security&stack=react");
    expect(items[2]!.href).toBe("/org/acme?tab=plan&stack=react");
  });
});
