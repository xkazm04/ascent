// The security check battery is the deterministic core of the D9 score — reproducible, auditable, no
// LLM. These pin the grading (effectiveness, not mere presence), the risk-weighted aggregation, the
// posture/exposure split, and the n/a handling (a control that can't be evaluated is EXCLUDED from the
// mean, never scored 0).

import { describe, it, expect } from "vitest";
import { computeSecurityChecks } from "./checks";
import { classifyApp } from "@/lib/github/check-suites";
import type { AppInventory } from "@/lib/github/check-suites";
import type { Governance, RepoFile, RepoSnapshot, SecurityExposure, SecurityPosture } from "@/lib/types";

function snap(files: { path: string; content: string }[], treePaths: string[] = []): RepoSnapshot {
  const tree: RepoFile[] = [...files.map((f) => f.path), ...treePaths].map((p) => ({ path: p, type: "blob" as const }));
  return {
    meta: { owner: "acme", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree,
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
const gov = (over: Partial<Governance> = {}): Governance => ({
  defaultBranch: "main", protected: true, requiresPullRequest: true, requiredApprovals: 1,
  requiresCodeOwnerReview: false, requiresStatusChecks: true, requiresSignatures: false, linearHistory: false, ruleCount: 3, readable: true, ...over,
});
const get = (a: ReturnType<typeof computeSecurityChecks>, id: string) => a.checks.find((c) => c.id === id)!;
/** An installed-App inventory on the scored commit, from bare slugs. */
const inv = (...slugs: string[]): AppInventory => ({
  sha: "deadbeef",
  apps: slugs.map((slug) => ({ slug, name: slug, conclusion: "success" })),
  total: slugs.length,
  truncated: false,
});

describe("computeSecurityChecks — grading is effectiveness, not presence", () => {
  it("branch protection is graded by what's ENFORCED, not just protected:true", () => {
    const bare = computeSecurityChecks(snap([]), gov({ requiredApprovals: 0, requiresStatusChecks: false }), null, null);
    const full = computeSecurityChecks(snap([]), gov({ requiredApprovals: 2, requiresStatusChecks: true, requiresSignatures: true, requiresCodeOwnerReview: true }), null, null);
    expect(get(bare, "branch-protection").score).toBe(3); // protected only
    expect(get(full, "branch-protection").score).toBe(10);
  });

  it("token-permissions grades by the FRACTION of workflows that scope their token", () => {
    const s = snap([
      { path: ".github/workflows/a.yml", content: "permissions:\n  contents: read\njobs: {}" },
      { path: ".github/workflows/b.yml", content: "jobs: {}" }, // no permissions block
    ]);
    expect(get(computeSecurityChecks(s, null, null, null), "token-permissions").score).toBe(5);
  });

  it("token-permissions credits JOB-LEVEL permissions blocks, not just top-level (P0-3)", () => {
    // Job-scoped least-privilege (`contents: read` on a job) is equally valid; the old `^permissions:`
    // regex (column 0 only) scored it 0 and penalized correct security posture.
    const s = snap([
      { path: ".github/workflows/a.yml", content: "jobs:\n  build:\n    permissions:\n      contents: read\n    steps: []" },
    ]);
    expect(get(computeSecurityChecks(s, null, null, null), "token-permissions").score).toBe(10);
  });

  it("workflow-only checks are n/a (not 0) when there are NO workflows to inspect (P0-3)", () => {
    // A repo whose CI runs off-GitHub (no .github/workflows) must not be floored at 0 on SAST/SBOM/
    // signing — that conflated "no SAST" with "no GitHub-native CI to look in".
    const a = computeSecurityChecks(snap([{ path: "README.md", content: "# r" }]), null, null, null);
    expect(get(a, "sast").score).toBeNull();
    expect(get(a, "sbom").score).toBeNull();
    expect(get(a, "signed-releases").score).toBeNull();
  });

  it("SAST is still 0 (real absence) when workflows exist but none run SAST (P0-3)", () => {
    const s = snap([{ path: ".github/workflows/ci.yml", content: "jobs:\n  test:\n    steps:\n      - run: go test ./..." }]);
    expect(get(computeSecurityChecks(s, null, null, null), "sast").score).toBe(0);
  });

  it("dependency-updates credits an active org/App-level bot from commit fingerprints, no config committed (P1-2)", () => {
    const withBot: RepoSnapshot = {
      meta: { owner: "acme", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
      tree: [{ path: "go.mod", type: "blob" }],
      files: [],
      commits: [
        { message: "Bump x from 1 to 2", authorLogin: "dependabot[bot]" },
        { message: "chore(deps): update y", authorLogin: "renovate[bot]" },
      ],
      truncated: false,
      coverage: 1,
    };
    expect(get(computeSecurityChecks(withBot, null, null, null), "dependency-updates").score).toBe(8);
  });

  it("dependency-updates is still 0 with no committed config and no bot commits (P1-2)", () => {
    const s = snap([{ path: "go.mod", content: "module x" }]); // snap() sets commits: []
    expect(get(computeSecurityChecks(s, null, null, null), "dependency-updates").score).toBe(0);
  });

  it("pinned-dependencies grades SHA-pinned vs tag-pinned actions", () => {
    const s = snap([{ path: ".github/workflows/ci.yml", content: "steps:\n  - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n  - uses: actions/setup-node@v4" }]);
    expect(get(computeSecurityChecks(s, null, null, null), "pinned-dependencies").score).toBe(5); // 1 of 2 pinned
  });

  it("dangerous-workflow is CRITICAL: a script-injection pattern scores 0", () => {
    const bad = snap([{ path: ".github/workflows/x.yml", content: "run: echo ${{ github.event.pull_request.title }}" }]);
    const clean = snap([{ path: ".github/workflows/x.yml", content: "run: echo hello" }]);
    expect(get(computeSecurityChecks(bad, null, null, null), "dangerous-workflow").score).toBe(0);
    expect(get(computeSecurityChecks(clean, null, null, null), "dangerous-workflow").score).toBe(10);
  });
});

describe("computeSecurityChecks — aggregation, split, and n/a handling", () => {
  it("an un-evaluable check is EXCLUDED from the mean, not scored 0", () => {
    // No governance → branch-protection is null (excluded), not a 0 that would tank posture.
    const s = snap([{ path: ".github/workflows/ci.yml", content: "run: echo hi" }]); // clean dangerous-workflow=10, no perms=0
    const a = computeSecurityChecks(s, null, null, null);
    expect(get(a, "branch-protection").score).toBeNull();
    expect(a.posture).toBeGreaterThan(0);
  });

  it("exposure is a SEPARATE axis; unknown exposure leaves D9 = posture", () => {
    const a = computeSecurityChecks(snap([]), gov(), { advisoryCount: 0, advisoryCapped: false, orgSecurityPolicy: true } as SecurityPosture, null);
    expect(a.exposure).toBeNull();
    expect(a.d9).toBe(a.posture);
    expect(get(a, "known-vulnerabilities").score).toBeNull();
  });

  it("open vulnerabilities dock the score (exposure folds in at 20%)", () => {
    const exp: SecurityExposure = { known: true, source: "osv", critical: 2, high: 1, medium: 0, low: 0, scanned: 400 };
    const clean: SecurityExposure = { known: true, source: "osv", critical: 0, high: 0, medium: 0, low: 0, scanned: 400 };
    const withVulns = computeSecurityChecks(snap([]), gov(), null, exp);
    const withClean = computeSecurityChecks(snap([]), gov(), null, clean);
    expect(get(withVulns, "known-vulnerabilities").score).toBe(0); // 10 - (2*4 + 1*2) clamped
    expect(withClean.d9).toBeGreaterThan(withVulns.d9); // clean deps score higher than vulnerable
  });

  it("is deterministic: identical inputs → identical output", () => {
    const s = snap([{ path: ".github/workflows/ci.yml", content: "permissions:\n  contents: read\nrun: echo hi" }]);
    const a = computeSecurityChecks(s, gov(), null, null);
    const b = computeSecurityChecks(s, gov(), null, null);
    expect(a).toEqual(b);
  });

  it("evidence lines are machine-parseable (Name [group/risk]: score/10 — detail)", () => {
    const a = computeSecurityChecks(snap([]), gov(), null, null);
    expect(a.evidence.every((l) => /^.+ \[(posture|exposure)\/\w+\]: (n\/a|\d+)\/10 — /.test(l))).toBe(true);
  });
});

// Pinned-dependencies counted EVERY Dockerfile `FROM` line toward the denominator, including shapes
// that structurally cannot carry a digest: a multi-stage alias reference (`FROM builder`) is an
// internal pointer at a stage this same file declared, and `FROM scratch` is the empty base image.
// A repo that pinned every EXTERNAL image was therefore still scored down for its own stage graph.
describe("pinned-dependencies — Dockerfile FROM lines", () => {
  const score = (content: string) =>
    get(computeSecurityChecks(snap([{ path: "Dockerfile", content }]), null, null, null), "pinned-dependencies").score;

  it("scores a fully-pinned multi-stage build at 10, not down for its own stage aliases", () => {
    expect(
      score(`FROM node:20@sha256:aaaa AS builder
RUN npm ci
FROM builder AS test
RUN npm test
FROM node:20-slim@sha256:bbbb
COPY --from=builder /app /app`),
    ).toBe(10);
  });

  it("does not count FROM scratch — there is nothing to pin", () => {
    expect(
      score(`FROM golang:1.22@sha256:aaaa AS build
FROM scratch
COPY --from=build /x /x`),
    ).toBe(10);
  });

  it("still penalises a genuinely unpinned external image", () => {
    const s = score(`FROM node:20@sha256:aaaa AS builder
FROM python:3.12`);
    expect(s).toBeLessThan(10);
    expect(s).toBeGreaterThan(0);
  });

  it("treats a registry image that merely shares a stage name as external", () => {
    // `builder` is internal ONLY when this file declared it via `AS builder`.
    expect(score(`FROM builder:latest
RUN true`)).toBe(0);
  });
});

// The write-all cap only matched `contents: write` as the FIRST key after the `permissions:` header,
// so the extremely common `permissions:\n  issues: read\n  contents: write` escaped it and the workflow
// scored as if it were least-privilege — the check's headline number inverted for the case it exists
// to catch.
describe("token-permissions — broad write grants are capped wherever they sit", () => {
  const scoreOf = (content: string) =>
    get(computeSecurityChecks(snap([{ path: ".github/workflows/a.yml", content }]), null, null, null), "token-permissions")
      .score;

  it("caps a contents:write grant that is NOT the first key in the block", () => {
    expect(
      scoreOf(`permissions:
  issues: read
  pull-requests: read
  contents: write
jobs: {}`),
    ).toBeLessThanOrEqual(4);
  });

  it("still caps it when it IS the first key (unchanged)", () => {
    expect(
      scoreOf(`permissions:
  contents: write
jobs: {}`),
    ).toBeLessThanOrEqual(4);
  });

  it("caps the other commonly-abused broad grants", () => {
    for (const key of ["packages", "id-token", "actions"]) {
      expect(
        scoreOf(`permissions:
  contents: read
  ${key}: write
jobs: {}`),
        `${key}: write must be capped`,
      ).toBeLessThanOrEqual(4);
    }
  });

  it("does NOT cap a genuinely least-privilege block", () => {
    expect(
      scoreOf(`permissions:
  contents: read
  issues: read
jobs: {}`),
    ).toBe(10);
  });

  it("does not let a later, dedented key leak into the block", () => {
    // `contents: write` here belongs to a sibling mapping, not to permissions.
    expect(
      scoreOf(`permissions:
  contents: read
some-other-key:
  contents: write`),
    ).toBe(10);
  });
});

// Security configured in GitHub SETTINGS rather than committed as code (default-setup CodeQL, org-level
// Socket/Snyk/Wiz) is invisible to a file scan — flask and next.js scored SAST 0 on controls they run.
// The installed-App inventory (Apps that posted a check suite on the scored commit) closes that gap. It
// is strictly ADDITIVE: null must reproduce the old numbers byte-for-byte, and an observed App may only
// raise a check. These pin both halves.
describe("App inventory — additive only, never lowers a score", () => {
  const noSastWf = snap([{ path: ".github/workflows/ci.yml", content: "jobs:\n  test:\n    steps:\n      - run: go test ./..." }]);

  it("a null inventory reproduces the pre-inventory assessment byte-for-byte", () => {
    // Hard pin, not a self-comparison: these are the exact evidence lines the battery emitted before the
    // inventory existed. If threading `apps` through ever perturbs a check, this fails loudly.
    const a = computeSecurityChecks(noSastWf, gov(), null, null, null);
    expect(a.evidence).toEqual([
      "Branch protection [posture/high]: 8/10 — Default branch: protected, 1 approval(s), status checks.",
      "Dangerous workflow [posture/critical]: 10/10 — No script-injection or untrusted-checkout patterns detected.",
      "Token permissions [posture/high]: 0/10 — 0/1 workflows set an explicit `permissions:` scope.",
      "SAST [posture/medium]: 0/10 — No SAST (CodeQL/Semgrep/Sonar) wired into CI.",
      "Dependency updates [posture/high]: 0/10 — No dependency-update tool committed.",
      "Pinned dependencies [posture/medium]: n/a/10 — No Actions/Docker dependencies to pin.",
      "Security policy [posture/medium]: 0/10 — No security policy (SECURITY.md) found.",
      "Signed releases [posture/high]: 0/10 — No artifact signing / provenance in CI.",
      "SBOM [posture/low]: 0/10 — No SBOM generation.",
      "Known vulnerabilities [exposure/high]: n/a/10 — Dependency vulnerabilities not inspected (no lockfile / no alert access).",
    ]);
    // …and omitting the argument entirely is the same thing (the parameter defaults to null).
    expect(computeSecurityChecks(noSastWf, gov(), null, null)).toEqual(a);
  });

  it("an inventory of unrelated Apps changes nothing at all", () => {
    const base = computeSecurityChecks(noSastWf, gov(), null, null, null);
    expect(computeSecurityChecks(noSastWf, gov(), null, null, inv("vercel", "codecov", "sentry"))).toEqual(base);
  });

  it("SAST: default-setup code scanning fills in the n/a when there are no workflows at all", () => {
    const s = snap([{ path: "README.md", content: "# r" }]);
    expect(get(computeSecurityChecks(s, null, null, null, null), "sast").score).toBeNull();
    const withApp = get(computeSecurityChecks(s, null, null, null, inv("github-code-scanning")), "sast");
    expect(withApp.score).toBe(10);
    expect(withApp.evidence).toBe("Code scanning App active on the scored commit (github-code-scanning).");
    expect(withApp.remediation).toBeUndefined();
  });

  it("SAST: workflows exist but commit no SAST — an App turns the 0 into a 10 (flask/next.js case)", () => {
    expect(get(computeSecurityChecks(noSastWf, gov(), null, null, null), "sast").score).toBe(0);
    const withApp = get(computeSecurityChecks(noSastWf, gov(), null, null, inv("github-code-scanning")), "sast");
    expect(withApp.score).toBe(10);
    expect(withApp.evidence).toBe("Code scanning App active on the scored commit (github-code-scanning).");
  });

  it("SAST: the whole D9 moves UP when that 0 flips to 10", () => {
    const before = computeSecurityChecks(noSastWf, gov(), null, null, null);
    const after = computeSecurityChecks(noSastWf, gov(), null, null, inv("github-code-scanning"));
    expect(after.d9).toBeGreaterThan(before.d9);
    expect(after.posture).toBeGreaterThan(before.posture);
  });

  it("SAST: a committed, PR-gating workflow keeps its own evidence and appends the App", () => {
    const s = snap([
      { path: ".github/workflows/codeql.yml", content: "on: [pull_request]\njobs:\n  analyze:\n    steps:\n      - uses: github/codeql-action/analyze@v3" },
    ]);
    expect(get(computeSecurityChecks(s, null, null, null, null), "sast").evidence).toBe("SAST runs on PR/push.");
    const withApp = get(computeSecurityChecks(s, null, null, null, inv("github-code-scanning", "semgrep-app")), "sast");
    expect(withApp.score).toBe(10);
    expect(withApp.evidence).toContain("SAST runs on PR/push");
    expect(withApp.evidence).toContain("github-code-scanning, semgrep-app");
  });

  it("SAST: a non-gating workflow (6) plus an App that posts on the commit is a 10", () => {
    const s = snap([
      { path: ".github/workflows/codeql.yml", content: "on:\n  workflow_dispatch:\njobs:\n  analyze:\n    steps:\n      - uses: github/codeql-action/analyze@v3" },
    ]);
    const bare = get(computeSecurityChecks(s, null, null, null, null), "sast");
    expect(bare.score).toBe(6);
    expect(bare.remediation).toBeDefined();
    const withApp = get(computeSecurityChecks(s, null, null, null, inv("github-code-scanning")), "sast");
    expect(withApp.score).toBe(10);
    expect(withApp.evidence).toContain("not clearly gating PRs");
    expect(withApp.evidence).toContain("github-code-scanning");
    expect(withApp.remediation).toBeUndefined();
  });

  it("dependency-updates: a supply-chain App earns partial credit over a bare 0, keeping the remediation", () => {
    const s = snap([{ path: "go.mod", content: "module x" }]); // no config, no bot commits
    expect(get(computeSecurityChecks(s, null, null, null, null), "dependency-updates").score).toBe(0);
    const withApp = get(computeSecurityChecks(s, null, null, null, inv("socket-security")), "dependency-updates");
    expect(withApp.score).toBe(6);
    expect(withApp.evidence).toBe("Supply-chain scanner App active on the scored commit (socket-security); no dependency-update config committed.");
    expect(withApp.remediation).toBe("Add a `.github/dependabot.yml` (or Renovate) config.");
  });

  it("dependency-updates: a committed config still wins outright — the App cannot change it", () => {
    const s = snap([{ path: ".github/dependabot.yml", content: "version: 2" }]);
    const withApp = get(computeSecurityChecks(s, null, null, null, inv("socket-security", "snyk")), "dependency-updates");
    expect(withApp.score).toBe(10);
    expect(withApp.evidence).toBe("Automated dependency updates configured (Dependabot/Renovate).");
  });

  it("dependency-updates: a hash-suffixed Wiz slug still classifies as supply-chain", () => {
    expect(classifyApp("wiz-abc123")).toBe("supply-chain");
    const s = snap([{ path: "go.mod", content: "module x" }]);
    const withApp = get(computeSecurityChecks(s, null, null, null, inv("wiz-abc123")), "dependency-updates");
    expect(withApp.score).toBe(6);
    expect(withApp.evidence).toContain("wiz-abc123");
  });

  it("adds no new check to the battery — the id set is unchanged with or without an inventory", () => {
    const ids = (a: ReturnType<typeof computeSecurityChecks>) => a.checks.map((c) => c.id);
    expect(ids(computeSecurityChecks(noSastWf, gov(), null, null, inv("github-code-scanning", "socket-security")))).toEqual(
      ids(computeSecurityChecks(noSastWf, gov(), null, null, null)),
    );
  });
});
