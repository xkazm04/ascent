// The foundation parsers against the shapes the registry documents (`docs/fleet-map.md`) and the
// manifest this repo actually carries. What is defended: a key the reader does not understand is
// ignored, never turned into a scope that excludes something.

import { describe, expect, it } from "vitest";
import { parseDirectionsLedger, parseManifestDomains, parseManifestFoundation, parseManifestScope } from "./conformance-foundation";

const MANIFEST = `schema: ai-manifest
repo:
  name: ascent
knowledge:
  domains: [software-engineering, media-craft]   # two bundles
skills:
  - conform
scope:
  does:
    - the maturity index
  does_not:
    - agent runtime
  out_of_scope_categories:
    - software-engineering/llm-agent/companion
    - "software-engineering/ui-surfaces/input-and-editing"
  out_of_scope_subjects:
  directions_ledger: .ai/directions/ledger.jsonl
next:
  key: value
`;

describe("parseManifestDomains", () => {
  it("reads the inline list the registry's domainsOf() reads", () => {
    expect(parseManifestDomains(MANIFEST)).toEqual(["software-engineering", "media-craft"]);
  });
  it("also reads the block form", () => {
    expect(parseManifestDomains("knowledge:\n  domains:\n    - a\n    - 'b'\nskills: []\n")).toEqual(["a", "b"]);
  });
  it("is [] for a manifest that declares none", () => {
    expect(parseManifestDomains("schema: ai-manifest\n")).toEqual([]);
    expect(parseManifestDomains("knowledge:\n  domains: []\n")).toEqual([]);
  });
});

describe("parseManifestScope", () => {
  it("reads both exclusion lists, unquoting and dropping comments", () => {
    expect(parseManifestScope(MANIFEST)).toEqual({
      outOfScopeCategories: ["software-engineering/llm-agent/companion", "software-engineering/ui-surfaces/input-and-editing"],
      outOfScopeSubjects: [],
    });
  });
  it("stops at the next top-level key", () => {
    const scope = parseManifestScope("scope:\n  out_of_scope_subjects: [x/y]\nother:\n  out_of_scope_subjects: [x/z]\n");
    expect(scope?.outOfScopeSubjects).toEqual(["x/y"]);
  });
  it("is null when there is no scope block — 'missing', not 'empty'", () => {
    expect(parseManifestScope("knowledge:\n  domains: [a]\n")).toBeNull();
    expect(parseManifestFoundation("knowledge:\n  domains: [a]\n")).toEqual({ domains: ["a"], scope: null });
  });
  it("treats a scope block with no exclusion keys as empty lists", () => {
    expect(parseManifestScope("scope:\n  does:\n    - x\n")).toEqual({ outOfScopeCategories: [], outOfScopeSubjects: [] });
  });
});

describe("parseDirectionsLedger", () => {
  const row = (o: Record<string, unknown>) => JSON.stringify({ date: "2026-09-03", bundle: "software-engineering", by: "x", ...o });

  it("keeps the LATEST decision per subject — the ledger is chronological", () => {
    const text = [row({ subject: "table", decision: "deferred" }), row({ subject: "table", decision: "accepted" }), row({ subject: "feed", decision: "declined" })].join("\n");
    expect(parseDirectionsLedger(text)).toEqual([
      { subject: "table", bundle: "software-engineering", decision: "accepted" },
      { subject: "feed", bundle: "software-engineering", decision: "declined" },
    ]);
  });
  it("skips a torn or foreign line without losing the rest", () => {
    const text = [row({ subject: "table", decision: "declined" }), "{torn", row({ subject: "feed", decision: "maybe" }), row({ decision: "accepted" })].join("\n");
    expect(parseDirectionsLedger(text)).toEqual([{ subject: "table", bundle: "software-engineering", decision: "declined" }]);
  });
  it("keys a bundle-less row under an empty bundle, where no subject can match it", () => {
    expect(parseDirectionsLedger(JSON.stringify({ subject: "table", decision: "declined" }))).toEqual([{ subject: "table", bundle: "", decision: "declined" }]);
  });
  it("is [] for an empty file", () => {
    expect(parseDirectionsLedger("")).toEqual([]);
  });
});
