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
import type { SecurityOverview } from "@/lib/org/security";
import type { OrgSupplyChain } from "@/lib/security/supply-chain";

function overview(): SecurityOverview {
  return {
    org: "acme",
    periodTitle: "all time",
    generatedOn: "2026-07-16",
    dimLabel: "Supply Chain & Security",
    avgSecurity: 61,
    securityDelta: null,
    scanned: 2,
    band: { critical: 0, weak: 1, ok: 1, strong: 0 },
    weakest: [],
    governance: null,
    unprotected: [],
    securityGate: { minSecurity: 40, passing: 2, failing: 0, failingRepos: [] },
    register: [],
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
