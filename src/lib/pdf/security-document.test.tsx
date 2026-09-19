// Pins security-posture-audit-log #1 (ambiguity-ui-scan-2026-07-16): the auditor-facing PDF used to
// claim "Supply-chain & security posture" in its subject and footer while never receiving supply-chain
// data — and it omitted the degraded ("advisory fetch FAILED") warning the page banner and the LLM
// brief both carry. The document now (a) only claims "Supply-chain" when it actually carries the
// supply-chain signal, (b) renders an explicit "Supply chain — UNKNOWN" block when the fetch degraded,
// and (c) renders the advisory totals (with the demo-data label) when scanning is live.
//
// SecurityDocument returns plain React elements, so we assert structurally on the element tree (same
// approach as report-document.test.ts) — no @react-pdf binary render needed.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { SecurityDocument } from "./security-document";
import { WHAT_TO_FIX_ISSUE_CAP, WHAT_TO_FIX_REPO_CAP, type SecurityOverview, type SecurityRegisterRow } from "@/lib/org/security";
import type { OrgSupplyChain } from "@/lib/security/supply-chain";

function overview(overrides: Partial<SecurityOverview> = {}): SecurityOverview {
  return {
    org: "acme",
    periodTitle: "all time",
    generatedOn: "2026-07-16",
    dimLabel: "Supply Chain & Security",
    avgSecurity: 61,
    securityDelta: null,
    securityCohortSize: null,
    scanned: 2,
    band: { critical: 0, weak: 1, ok: 1, strong: 0 },
    weakest: [],
    governance: null,
    unprotected: [],
    securityGate: { minSecurity: 40, passing: 2, failing: 0, failingRepos: [] },
    register: [],
    ...overrides,
  };
}

function registerRow(over: Partial<SecurityRegisterRow> = {}): SecurityRegisterRow {
  return {
    name: "web",
    fullName: "acme/web",
    score: 72,
    measured: true,
    gateReason: null,
    rules: null,
    checks: [],
    issues: [],
    summary: "",
    ...over,
  };
}

function supplyLive(overrides: Partial<OrgSupplyChain> = {}): OrgSupplyChain {
  return {
    provider: "github",
    demo: false,
    scanned: 2,
    totals: { critical: 1, high: 2, medium: 0, low: 3, total: 6 },
    repos: [
      { fullName: "acme/api", name: "api", critical: 1, high: 2, medium: 0, low: 3, total: 6 },
      { fullName: "acme/web", name: "web", critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    ],
    ...overrides,
  };
}

/** Flatten every string in a React element tree (children + string props like Document's subject). */
function collectText(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    collectText(props.children as ReactNode, out);
  }
  return out;
}

function subjectOf(el: ReactElement): string {
  return String((el.props as Record<string, unknown>).subject);
}

function childList(el: ReactElement): ReactNode[] {
  const c = (el.props as { children?: ReactNode }).children;
  if (c == null) return [];
  return Array.isArray(c) ? c : [c];
}

/** D9 cell text for a named risk-register row (the Text after the repo name). */
function d9CellOf(root: ReactElement, repoName: string): string {
  let found: string | null = null;
  function walk(node: ReactNode): void {
    if (found != null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isValidElement(node)) return;
    const kids = childList(node);
    const texts = kids.map((k) => (isValidElement(k) ? collectText(k).join("").trim() : ""));
    const i = texts.indexOf(repoName);
    if (i >= 0 && i + 1 < texts.length) {
      found = texts[i + 1];
      return;
    }
    kids.forEach(walk);
  }
  walk(root);
  if (found == null) throw new Error(`no register row named ${repoName}`);
  return found;
}

describe("SecurityDocument — honest supply-chain claims (audit-log 2026-07-16 #1)", () => {
  it("with supply-chain OFF, the subject and footer claim only 'Security posture'", () => {
    const el = SecurityDocument({ overview: overview() }) as ReactElement;
    expect(subjectOf(el)).toBe("Security posture");
    const text = collectText(el).join(" ");
    expect(text).toContain("Security posture");
    expect(text).not.toContain("Supply-chain & security posture");
    expect(text).not.toContain("Supply chain (Dependabot");
  });

  it("with live supply data, claims 'Supply-chain & security posture' AND renders the advisory totals", () => {
    const el = SecurityDocument({ overview: overview(), supply: supplyLive() }) as ReactElement;
    expect(subjectOf(el)).toBe("Supply-chain & security posture");
    const text = collectText(el).join(" ");
    expect(text).toContain("Supply chain (Dependabot");
    expect(text).toContain("api"); // the advisory-bearing repo is listed
  });

  it("labels mock-provider data as demo, mirroring securityMarkdown", () => {
    const el = SecurityDocument({
      overview: overview(),
      supply: supplyLive({ provider: "mock", demo: true }),
    }) as ReactElement;
    expect(collectText(el).join(" ")).toContain(" — demo data");
  });

  it("renders the 'Supply chain — UNKNOWN' warning when the advisory fetch degraded", () => {
    const degraded: OrgSupplyChain = {
      provider: "github",
      demo: false,
      degraded: true,
      scanned: 0,
      totals: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      repos: [],
    };
    const el = SecurityDocument({ overview: overview(), supply: degraded }) as ReactElement;
    expect(subjectOf(el)).toBe("Supply-chain & security posture");
    const text = collectText(el).join(" ");
    expect(text).toContain("Supply chain — UNKNOWN");
    expect(text).toContain("not evidence of a clean supply chain");
  });
});

describe("SecurityDocument — unmeasured D9 is a void, never the fail-closed 0", () => {
  it("1 of 1 unmeasured rows omit a numeral", () => {
    const el = SecurityDocument({
      overview: overview({
        register: [
          registerRow({
            name: "legacy",
            fullName: "acme/legacy",
            score: 0,
            measured: false,
            gateReason: "D9 not measured",
          }),
        ],
      }),
    }) as ReactElement;
    const unmeasured = ["legacy"];
    const omitted = unmeasured.filter((name) => !/\d/.test(d9CellOf(el, name)));
    expect(omitted).toEqual(unmeasured);
    expect(unmeasured).toHaveLength(1);
    // Gate still FAILS — fail-closed is untouched; only the fabricated reading is gone.
    expect(collectText(el).join(" ")).toContain("FAIL — D9 not measured");
  });

  it("a measured reading still prints its score, including a genuine 0", () => {
    const el = SecurityDocument({
      overview: overview({
        register: [
          registerRow({ name: "web", fullName: "acme/web", score: 72, measured: true }),
          registerRow({
            name: "floor",
            fullName: "acme/floor",
            score: 0,
            measured: true,
            gateReason: "Security 0 < 40",
          }),
        ],
      }),
    }) as ReactElement;
    expect(d9CellOf(el, "web")).toBe("72");
    expect(d9CellOf(el, "floor")).toBe("0");
  });
});

describe("SecurityDocument — What to fix from failing rows' issues/summary", () => {
  it("renders failing-row issues and summary, and does not invent a findings list from checks", () => {
    const el = SecurityDocument({
      overview: overview({
        register: [
          registerRow({
            name: "legacy-api",
            fullName: "acme/legacy-api",
            score: 22,
            gateReason: "Security 22 < 50",
            issues: ["No SAST configuration visible", "No SBOM generation evidenced"],
            summary: "Weak supply-chain posture.",
            checks: [
              {
                id: "sast",
                name: "SAST",
                group: "posture",
                risk: "medium",
                score: 0,
                detail: "INVENTED-FROM-CHECKS",
              },
            ],
          }),
          registerRow({
            name: "web",
            fullName: "acme/web",
            score: 72,
            issues: ["passing-row-issue"],
            summary: "Passing summary.",
          }),
        ],
      }),
    }) as ReactElement;
    const text = collectText(el).join(" ");
    expect(text).toContain("What to fix");
    expect(text).toContain("Weak supply-chain posture.");
    expect(text).toContain("No SAST configuration visible");
    expect(text).toContain("No SBOM generation evidenced");
    expect(text).not.toContain("passing-row-issue");
    expect(text).not.toContain("Passing summary.");
    expect(text).not.toContain("INVENTED-FROM-CHECKS");
  });

  it("keeps a disagreeing summary next to the detector issues (G1)", () => {
    const el = SecurityDocument({
      overview: overview({
        register: [
          registerRow({
            name: "api",
            fullName: "acme/api",
            score: 22,
            gateReason: "Security 22 < 50",
            summary: "Model notes Dependabot is present.",
            issues: ["No Dependabot alerts configuration visible"],
          }),
        ],
      }),
    }) as ReactElement;
    const text = collectText(el).join(" ");
    expect(text).toContain("Model notes Dependabot is present.");
    expect(text).toContain("No Dependabot alerts configuration visible");
  });

  it("omits the section when no failing row carries issues or summary", () => {
    const el = SecurityDocument({
      overview: overview({
        register: [registerRow({ gateReason: "Security 22 < 50", issues: [], summary: "" })],
      }),
    }) as ReactElement;
    expect(collectText(el).join(" ")).not.toContain("What to fix");
  });

  it("renders capped issues and a remainder for extra failing repos", () => {
    const manyIssues = Array.from({ length: WHAT_TO_FIX_ISSUE_CAP + 2 }, (_, i) => `gap-${i}`);
    const el = SecurityDocument({
      overview: overview({
        register: Array.from({ length: WHAT_TO_FIX_REPO_CAP + 1 }, (_, i) =>
          registerRow({
            name: `r-${i}`,
            fullName: `acme/r-${i}`,
            score: 22,
            gateReason: "Security 22 < 40",
            issues: manyIssues,
            summary: "",
          }),
        ),
      }),
    }) as ReactElement;
    const text = collectText(el).join(" ");
    expect(text).toContain("gap-0");
    expect(text).toContain("…and 2 more issues");
    expect(text).not.toContain(`gap-${WHAT_TO_FIX_ISSUE_CAP}`);
    expect(text).toContain("…and 1 more failing repos.");
  });

  it("an unmeasured failing row with issues still voids the D9 cell (no numeral)", () => {
    const el = SecurityDocument({
      overview: overview({
        register: [
          registerRow({
            name: "legacy",
            fullName: "acme/legacy",
            score: 0,
            measured: false,
            gateReason: "D9 not measured",
            issues: ["Re-scan so D9 can be measured"],
            summary: "No D9 row on the latest scan.",
          }),
        ],
      }),
    }) as ReactElement;
    expect(d9CellOf(el, "legacy")).not.toMatch(/\d/);
    const text = collectText(el).join(" ");
    expect(text).toContain("What to fix");
    expect(text).toContain("Re-scan so D9 can be measured");
    expect(text).toContain("No D9 row on the latest scan.");
  });
});
