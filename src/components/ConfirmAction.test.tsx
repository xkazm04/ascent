// The confirm dialog's VALUE is its copy: a prompt that says "Are you sure?" tells the user nothing they
// didn't already know, and they click through it. The bar is that it states WHAT happens and HOW MANY
// things it affects. The copy builders are pure so that bar is testable in this repo's node-only vitest
// environment (there is no jsdom / testing-library here — see the note in ConfirmAction.tsx).

import { describe, it, expect } from "vitest";
import { segmentDeleteConfirm } from "./ConfirmAction";

describe("segmentDeleteConfirm — states scope, not 'Are you sure?'", () => {
  it("names the segment and counts the tags that go with it", () => {
    const spec = segmentDeleteConfirm("platform", 12);
    expect(spec.title).toContain("platform");
    expect(spec.body).toContain("12 repo tags");
    // The tags also drive the Overview filter + comparison — the collateral damage must be stated.
    expect(spec.body).toContain("Overview filter");
    expect(spec.body).toContain("can't be undone");
    expect(spec.tone).toBe("danger");
  });

  it("singularizes a lone tag", () => {
    expect(segmentDeleteConfirm("mobile", 1).body).toContain("1 repo tag");
    expect(segmentDeleteConfirm("mobile", 1).body).not.toContain("1 repo tags");
  });

  it("omits the tag clause entirely when the segment has none", () => {
    const spec = segmentDeleteConfirm("empty", 0);
    expect(spec.body).not.toContain("repo tag");
    expect(spec.body).toContain("permanently deletes the segment");
  });

  it("never falls back to a contentless prompt", () => {
    const spec = segmentDeleteConfirm("legacy", 3);
    expect(spec.body.toLowerCase()).not.toContain("are you sure");
    expect(spec.confirmLabel).not.toMatch(/^(ok|yes)$/i);
  });
});
