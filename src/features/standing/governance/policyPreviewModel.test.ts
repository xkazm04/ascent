// Pins the gate-policy preview's client state: a debounced draft goes stale on every edit, only the
// LATEST draft's answer is ever shown, and a draft that removes a bar asks before it saves.

import { describe, it, expect } from "vitest";
import {
  INITIAL_PREVIEW,
  derivePreview,
  guardSave,
  previewReducer,
  previewSummary,
  type PolicyPreviewData,
  type PreviewState,
} from "./policyPreviewModel";
import type { GatePolicyImpact } from "@/lib/org/gate-policy-impact";

function impact(over: Partial<GatePolicyImpact> = {}): GatePolicyImpact {
  return {
    assessed: 3,
    before: { passing: 3, failing: 0 },
    after: { passing: 2, failing: 1 },
    newlyFailing: [{ name: "a", fullName: "acme/a", overall: 55, reasons: ["Overall score 55 is below the required 60."] }],
    newlyPassing: [],
    untested: { governance: 1 },
    unjudged: { incomplete: 0 },
    removed: [],
    ...over,
  };
}
const data = (over: Partial<PolicyPreviewData> = {}, imp: Partial<GatePolicyImpact> = {}): PolicyPreviewData => ({
  effective: { minOverall: 60, requireProtectedBranch: true },
  impact: impact(imp),
  admissionUnread: false,
  ...over,
});

const run = (...actions: Parameters<typeof previewReducer>[1][]): PreviewState => actions.reduce(previewReducer, INITIAL_PREVIEW);

describe("previewReducer", () => {
  it("a draft edit marks the preview stale", () => {
    expect(run({ type: "edit", seq: 1 }).status).toBe("stale");
  });

  it("a response tagged with an older draft is discarded", () => {
    const s = run({ type: "edit", seq: 1 }, { type: "request", seq: 1 }, { type: "edit", seq: 2 }, { type: "response", seq: 1, data: data() });
    expect(s.status).toBe("stale");
    expect(s.data).toBeNull();
  });

  it("the latest draft's response is ready with the one-line summary", () => {
    const s = run({ type: "edit", seq: 1 }, { type: "edit", seq: 2 }, { type: "request", seq: 2 }, { type: "response", seq: 2, data: data() });
    expect(s.status).toBe("ready");
    expect(derivePreview(s).summary).toBe("Saving turns 1 repo red, 0 green; 1 cannot be judged on the new protection bar");
  });

  it("an older draft's error cannot overwrite the newer draft's state", () => {
    const s = run({ type: "edit", seq: 1 }, { type: "edit", seq: 2 }, { type: "error", seq: 1, message: "boom" });
    expect(s.status).toBe("stale");
    expect(s.error).toBeNull();
  });

  it("returning to the saved bar goes idle and drops the stale answer", () => {
    const s = run({ type: "edit", seq: 1 }, { type: "response", seq: 1, data: data() }, { type: "idle", seq: 2 });
    expect(s.status).toBe("idle");
    expect(s.data).toBeNull();
  });
});

describe("previewSummary", () => {
  it("pluralizes and names incomplete scans apart", () => {
    const d = data({}, {
      newlyFailing: [
        { name: "a", fullName: "acme/a", overall: 41, reasons: [] },
        { name: "b", fullName: "acme/b", overall: 58, reasons: [] },
      ],
      newlyPassing: [{ name: "c", fullName: "acme/c", overall: 70, reasons: [] }],
      untested: {},
      unjudged: { incomplete: 2 },
    });
    expect(previewSummary(d)).toBe("Saving turns 2 repos red, 1 green; 2 scored nothing and are not judged");
  });

  it("an unreadable admission layer is never previewed as clean", () => {
    const d = data({ admissionUnread: true }, { newlyFailing: [], untested: {} });
    const s = previewSummary(d);
    expect(s).toMatch(/admission/i);
    expect(s).toMatch(/CI may be stricter/);
    expect(derivePreview(run({ type: "edit", seq: 1 }, { type: "response", seq: 1, data: d })).tone).toBe("warn");
  });

  it("a draft that sanitizes to nothing says it is previewed as the archetype default", () => {
    expect(previewSummary(data({ effective: null }, { untested: {} }))).toMatch(/archetype default/);
  });

  it("carries no em dash", () => {
    const all = [data(), data({ admissionUnread: true }), data({ effective: null })].map(previewSummary).join(" ");
    expect(all).not.toContain("—");
  });
});

describe("derivePreview - removing a bar asks first", () => {
  const removed = [{ label: "required controls", was: "Reported controls must not be failing: control.prepush.lint" }];

  it("a ready preview with a removed bar needs confirmation, and the copy names the bar", () => {
    const v = derivePreview(run({ type: "edit", seq: 1 }, { type: "response", seq: 1, data: data({}, { removed }) }));
    expect(v.saveNeedsConfirm).toBe(true);
    expect(v.confirmText).toContain("required controls");
    expect(v.confirmText).toContain("control.prepush.lint");
    expect(v.confirmText).not.toContain("—");
    expect(v.saveLabel).toBe("Save and remove 1 bar");
  });

  it("no removal, no confirmation", () => {
    const v = derivePreview(run({ type: "edit", seq: 1 }, { type: "response", seq: 1, data: data() }));
    expect(v.saveNeedsConfirm).toBe(false);
    expect(v.saveLabel).toBe("Save policy");
  });

  it("guardSave asks before a removing save and saves nothing on cancel", () => {
    const v = derivePreview(run({ type: "edit", seq: 1 }, { type: "response", seq: 1, data: data({}, { removed }) }));
    let saved = 0;
    const asked: string[] = [];
    guardSave(v, () => (saved += 1), (m) => (asked.push(m), false));
    expect(saved).toBe(0);
    expect(asked[0]).toContain("required controls");
    guardSave(v, () => (saved += 1), () => true);
    expect(saved).toBe(1);
  });

  it("guardSave saves without asking when nothing is removed", () => {
    let asked = false;
    let saved = 0;
    guardSave(derivePreview(INITIAL_PREVIEW), () => (saved += 1), () => (asked = true));
    expect([asked, saved]).toEqual([false, 1]);
  });

  it("idle carries no summary", () => {
    expect(derivePreview(INITIAL_PREVIEW).summary).toBeNull();
  });
});
