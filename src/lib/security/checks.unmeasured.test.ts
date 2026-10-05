// The battery's own verdict on a reading where NOTHING was gradable. A blind worktree scan of a repo
// with no workflows and no container files used to aggregate to posture 0 for want of a denominator —
// a number about nothing. It now says `unmeasured`, keeps the on-disk absences as UNVERIFIED notes,
// and every reading where any check scored (or that could see GitHub) is byte-identical to before.

import { describe, expect, it } from "vitest";
import { computeSecurityChecks } from "./checks";
import type { RepoSnapshot } from "@/lib/types";

function snap(files: { path: string; content: string }[]): RepoSnapshot {
  return {
    meta: { owner: "acme", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
const blind = { platformUnobservable: true };
const src = [{ path: "src/main.ts", content: "export {};" }];

describe("computeSecurityChecks — nothing gradable on a blind reading", () => {
  it("is `unmeasured`, with every check n/a and the withheld remediations marked unverified", () => {
    const a = computeSecurityChecks(snap(src), null, null, null, null, blind);
    expect(a.unmeasured).toBe(true);
    expect(a.checks.every((c) => c.score === null)).toBe(true);
    expect(a.gaps).toHaveLength(2);
    expect(a.gaps.every((g) => g.startsWith("Unverified:"))).toBe(true);
    expect(a.gaps.join(" ")).toContain("dependabot");
    expect(a.gaps.join(" ")).toContain("SECURITY.md");
  });

  it("an anonymous scan of the same tree is a measurement, exactly as before", () => {
    const a = computeSecurityChecks(snap(src), null, null, null, null);
    expect(a.unmeasured).toBeUndefined();
    expect(a.d9).toBe(0);
    expect(a.gaps.some((g) => g.startsWith("Unverified"))).toBe(false);
  });

  it("a committed file control ALONE stays unmeasured — one SECURITY.md must not read as D9 100", () => {
    // Every check GitHub could refute is excluded when blind, so the denominator would be just the files
    // that happen to exist. A measured blind D9 needs a CI- or container-derived check.
    const a = computeSecurityChecks(snap([...src, { path: "SECURITY.md", content: "x" }]), null, null, null, null, blind);
    expect(a.unmeasured).toBe(true);
    expect(a.gaps.join(" ")).not.toContain("SECURITY.md");
  });

  it("a workflow on disk is gradable — measured, and the blind exclusions mint no unverified gap", () => {
    const wf = { path: ".github/workflows/ci.yml", content: "on: [push]\npermissions:\n  contents: read\n" };
    const a = computeSecurityChecks(snap([...src, wf]), null, null, null, null, blind);
    expect(a.unmeasured).toBeUndefined();
    expect(a.gaps.some((g) => g.startsWith("Unverified"))).toBe(false);
  });
});
