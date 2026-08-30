import { describe, expect, it } from "vitest";
import { CONTROLS, controlDef, controlLabel, controlOrder, stateTone } from "@/lib/controls/catalog";
import { CONTROL_IDS, governanceToSamples, postureToSamples } from "@/lib/scan-probe-controls";
import type { Governance } from "@/lib/types";

const governance: Governance = {
  defaultBranch: "main",
  protected: true,
  requiresPullRequest: true,
  requiredApprovals: 2,
  requiresCodeOwnerReview: true,
  requiresStatusChecks: true,
  requiresSignatures: false,
  linearHistory: true,
  ruleCount: 3,
  readable: true,
};

describe("catalogue coverage", () => {
  // The catalogue and the probe's id list are ONE vocabulary. A control the probe can emit but the
  // catalogue cannot label renders as a raw kebab id on the timeline; the reverse is a dead entry.
  it("covers every id the probe mappers can emit", () => {
    const emitted = new Set([
      ...governanceToSamples(governance).map((s) => s.controlId),
      ...postureToSamples({ orgSecurityPolicy: true, advisoryCount: 1, advisoryCapped: false }).map((s) => s.controlId),
      CONTROL_IDS.repoPresent,
      CONTROL_IDS.repoVisibility,
      CONTROL_IDS.repoArchived,
    ]);
    const catalogued = new Set(CONTROLS.map((c) => c.id));
    for (const id of emitted) expect(catalogued.has(id), `catalogue is missing ${id}`).toBe(true);
    expect(catalogued.size).toBe(emitted.size);
  });

  it("every entry carries a label, a scope, at least one source and a failMeans sentence", () => {
    for (const c of CONTROLS) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(["repo", "org"]).toContain(c.scope);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      expect(c.failMeans.length, c.id).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
  });
});

describe("the unreadable-governance contract", () => {
  // Restated here as a catalogue-level guard: the labels exist to be shown beside states, and if the
  // mapper ever turned an unreadable read into `fail` every one of those labels would be a lie.
  it("readable:false maps EVERY governance control to unmeasurable, never fail", () => {
    for (const s of governanceToSamples({ ...governance, readable: false })) {
      expect(s.state, s.controlId).toBe("unmeasurable");
      expect(s.value, s.controlId).toBeNull();
      expect(controlDef(s.controlId), s.controlId).not.toBeNull();
    }
  });

  it("a null governance blob does the same", () => {
    for (const s of governanceToSamples(null)) expect(s.state).toBe("unmeasurable");
  });
});

describe("lookups", () => {
  it("labels a known id and falls back to the raw id for an unknown one", () => {
    expect(controlLabel(CONTROL_IDS.branchProtection)).toBe("Branch protection");
    expect(controlLabel("not-a-control")).toBe("not-a-control");
    expect(controlDef("not-a-control")).toBeNull();
  });

  it("sorts unknown ids LAST, not first", () => {
    expect(controlOrder("not-a-control")).toBe(CONTROLS.length);
    expect(controlOrder(CONTROL_IDS.branchProtection)).toBe(0);
  });

  it("unmeasurable has its own tone — neither good nor bad", () => {
    expect(stateTone("pass")).toBe("good");
    expect(stateTone("fail")).toBe("bad");
    expect(stateTone("unmeasurable")).toBe("unknown");
  });
});
