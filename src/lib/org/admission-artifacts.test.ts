// moonshot #8 — the managed-block splice and the diff a reviewer sees before anything is sent.
//
// The property under test is IDEMPOTENCE. Every customer-repo write in this lane is preceded by a
// dry-run diff, and an empty diff is what makes the caller refuse to open a PR. If the splice were
// not byte-stable, a nightly recompile would open an identical no-op PR on every repo, every night —
// the failure mode that trains a team to ignore the product's PRs entirely.

import { describe, it, expect } from "vitest";
import {
  managedBlockIsCurrent,
  renderManifestOversight,
  spliceManagedBlock,
  spliceManifestOversight,
  unifiedDiff,
} from "./admission-artifacts";

const BEGIN = "# BEGIN ascent:ai-stance v3";
const END = "# END ascent:ai-stance v3";
const BLOCK = [BEGIN, "infra/** @acme/platform", END].join("\n");

const EXISTING = ["# The team's own owners — do not touch", "* @acme/core", "docs/ @acme/writers"].join("\n");

describe("spliceManagedBlock", () => {
  it("appends the block to an existing file and leaves everything else byte-identical", () => {
    const { content, changed, replaced } = spliceManagedBlock(EXISTING, BLOCK, BEGIN, END);
    expect(changed).toBe(true);
    expect(replaced).toBe(false);
    expect(content.startsWith(EXISTING)).toBe(true);
    expect(content).toContain(BLOCK);
  });

  it("is IDEMPOTENT — re-splicing the same block returns the file unchanged", () => {
    const once = spliceManagedBlock(EXISTING, BLOCK, BEGIN, END).content;
    const twice = spliceManagedBlock(once, BLOCK, BEGIN, END);
    expect(twice.content).toBe(once);
    expect(twice.changed).toBe(false);
    expect(managedBlockIsCurrent(once, BLOCK, BEGIN, END)).toBe(true);
    expect(unifiedDiff("CODEOWNERS", once, twice.content)).toBe("");
  });

  it("REPLACES the managed region when the block changed, and touches nothing outside the markers", () => {
    const once = spliceManagedBlock(EXISTING, BLOCK, BEGIN, END).content;
    const next = [BEGIN, "infra/** @acme/platform", "prisma/** @acme/data", END].join("\n");
    const res = spliceManagedBlock(once, next, BEGIN, END);
    expect(res.replaced).toBe(true);
    expect(res.changed).toBe(true);
    // Every line the customer wrote survives, in order.
    for (const line of EXISTING.split("\n")) expect(res.content).toContain(line);
    expect(res.content).not.toContain("infra/** @acme/platform\n" + END); // the old region is gone
    expect(res.content).toContain("prisma/** @acme/data");
  });

  it("a stray BEGIN with no END never authorizes deleting the rest of the file", () => {
    // A half-written marker in a customer's file is a mistake, not a mandate. Append, leave it alone.
    const broken = [BEGIN, "* @someone", "more real content"].join("\n");
    const res = spliceManagedBlock(broken, BLOCK, BEGIN, END);
    expect(res.replaced).toBe(false);
    expect(res.content).toContain("more real content");
    expect(res.content).toContain("* @someone");
  });

  it("handles an empty base file without producing a leading blank line", () => {
    expect(spliceManagedBlock("", BLOCK, BEGIN, END).content).toBe(BLOCK + "\n");
  });

  it("normalizes trailing whitespace so a file with and without a final newline converge", () => {
    const a = spliceManagedBlock(EXISTING, BLOCK, BEGIN, END).content;
    const b = spliceManagedBlock(EXISTING + "\n", BLOCK, BEGIN, END).content;
    const c = spliceManagedBlock(EXISTING + "\n\n\n", BLOCK, BEGIN, END).content;
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("unifiedDiff", () => {
  it("is empty on a no-op — the signal the writer uses to refuse to open a PR", () => {
    expect(unifiedDiff("CODEOWNERS", EXISTING, EXISTING)).toBe("");
  });

  it("renders the added lines with a + and carries the file headers", () => {
    const after = spliceManagedBlock(EXISTING, BLOCK, BEGIN, END).content;
    const diff = unifiedDiff("CODEOWNERS", EXISTING, after);
    expect(diff).toContain("--- a/CODEOWNERS");
    expect(diff).toContain("+++ b/CODEOWNERS");
    expect(diff).toContain(`+${BEGIN}`);
    expect(diff).toContain("+infra/** @acme/platform");
    // Nothing the customer wrote appears as a removal.
    for (const line of EXISTING.split("\n")) expect(diff).not.toContain(`-${line}`);
  });

  it("shows a replacement as a removal AND an addition", () => {
    const diff = unifiedDiff("f", "a\nb\nc", "a\nB\nc");
    expect(diff).toContain("-b");
    expect(diff).toContain("+B");
    expect(diff).toContain(" a");
  });
});

describe("controls.oversight — METADATA, never a threshold", () => {
  const MANIFEST = [
    "schemaVersion: 0.3.0",
    "controls:",
    "  prePush: [lint, typecheck]",
    "  ciHardPass: [test, merge-gate]",
    "",
    "knowledge:",
    "  domains: [software-engineering]",
  ].join("\n");

  const block = renderManifestOversight({ tier: "T1", review: "One approval: the module owner.", provenance: ["human-approval"] });

  it("renders inside the controls block and declares no bar", () => {
    const out = spliceManifestOversight(MANIFEST, block)!;
    expect(out).toContain("  oversight:");
    expect(out).toContain("    tier: T1");
    // The lines land under `controls:` and before the next top-level key.
    expect(out.indexOf("  oversight:")).toBeGreaterThan(out.indexOf("controls:"));
    expect(out.indexOf("  oversight:")).toBeLessThan(out.indexOf("knowledge:"));
    // No threshold vocabulary reaches the manifest's DATA — the bar lives in the gate policy fold.
    // Comment lines are excluded: they say the opposite (that this is not a threshold), and asserting
    // over them would forbid the sentence that states the rule.
    const data = out.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(data).not.toMatch(/min[A-Z]|minimum|threshold/);
  });

  it("is idempotent — a second render replaces the block rather than stacking it", () => {
    const once = spliceManifestOversight(MANIFEST, block)!;
    const twice = spliceManifestOversight(once, block)!;
    expect(twice).toBe(once);
    expect(once.match(/ {2}oversight:/g)).toHaveLength(1);
  });

  it("quotes the free-text review sentence so a colon cannot restructure the document", () => {
    const risky = renderManifestOversight({ tier: "T0", review: "Two approvals: one from platform # not optional", provenance: [] });
    expect(risky).toContain('review: "Two approvals: one from platform # not optional"');
  });

  it("returns null rather than inventing a controls block that does not exist", () => {
    expect(spliceManifestOversight("schemaVersion: 0.3.0\n", block)).toBeNull();
  });
});
