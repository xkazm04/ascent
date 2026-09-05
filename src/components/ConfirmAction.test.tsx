// The confirm dialog's VALUE is its copy: a prompt that says "Are you sure?" tells the user nothing they
// didn't already know, and they click through it. The bar is that it states WHAT happens and HOW MANY
// things it affects. The copy builders are pure so that bar is testable in this repo's node-only vitest
// environment (there is no jsdom / testing-library here — see the note in ConfirmAction.tsx).

import { describe, it, expect } from "vitest";
import {
  segmentDeleteConfirm,
  draftPrConfirm,
  batchPrConfirm,
  retestConfirm,
  goalDeleteConfirm,
} from "./ConfirmAction";

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

describe("draftPrConfirm — a PR write into a customer repo names the repo", () => {
  it("names the repo and what is being seeded", () => {
    const spec = draftPrConfirm("acme/web", 'the "AI-Native" playbook');
    expect(spec.title).toContain("acme/web");
    expect(spec.body).toContain("acme/web");
    expect(spec.body).toContain('the "AI-Native" playbook');
    // It writes to the customer's repo — the body must say so, not "Are you sure?".
    expect(spec.body).toMatch(/branch and commit/);
    expect(spec.body.toLowerCase()).not.toContain("are you sure");
  });

  it("uses the recoverable (default) tone — a PR can be closed, it is not data loss", () => {
    expect(draftPrConfirm("acme/web", "a starter").tone).toBe("default");
  });
});

describe("batchPrConfirm — the fleet batch states the real count and the org", () => {
  it("counts the PRs that actually open and names the org", () => {
    const spec = batchPrConfirm(8, 25, "acme");
    expect(spec.title).toContain("8");
    expect(spec.title).toContain("acme");
    expect(spec.body).toContain("acme");
    expect(spec.confirmLabel).toBe("Open 8 PRs");
    expect(spec.tone).toBe("default");
  });

  it("caps the stated count at the server cap and warns about the overflow", () => {
    // 40 selected, server keeps 25 — the confirm must promise 25, not 40, so it can't over-state coverage.
    const spec = batchPrConfirm(40, 25, "acme");
    expect(spec.title).toContain("25");
    expect(spec.title).not.toContain("40 ");
    expect(spec.body).toContain("first 25 of 40");
    expect(spec.body).toContain("per-batch cap");
    expect(spec.confirmLabel).toBe("Open 25 PRs");
  });

  it("singularizes a lone repo", () => {
    const spec = batchPrConfirm(1, 25, "acme");
    expect(spec.title).toContain("1 acme repo?");
    expect(spec.confirmLabel).toBe("Open 1 PR");
  });
});

describe("retestConfirm — a metered re-scan names the repo and the cost", () => {
  it("names the repo and says it spends a quota slot", () => {
    const spec = retestConfirm("acme/web");
    expect(spec.title).toContain("acme/web");
    expect(spec.body).toContain("acme/web");
    expect(spec.body).toMatch(/weekly scan quota/);
    // Recoverable/metered, not irreversible loss.
    expect(spec.tone).toBe("default");
  });
});

describe("goalDeleteConfirm — a hard delete states the collateral history loss", () => {
  it("names the goal and warns the achievement history goes too", () => {
    const spec = goalDeleteConfirm("Reach AI-Native by Q3");
    expect(spec.title).toContain("Reach AI-Native by Q3");
    expect(spec.body).toContain("achievement history");
    expect(spec.body).toContain("can't be undone");
    // Irreversible data loss → the red danger tone.
    expect(spec.tone).toBe("danger");
  });
});
