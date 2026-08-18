// @vitest-environment jsdom
//
// security-posture-audit-log 2026-07-16 #3: mock-provider (SUPPLY_CHAIN_PROVIDER=mock) advisory counts
// must be LABELED as demo data and must not deep-link to GitHub — previously the fabricated counts
// rendered identically to real data, each linking to a Dependabot page showing something entirely
// different.

import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { SecurityRegisterRow } from "@/lib/org/security";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
// The score-cell drill-in modal is out of scope here (and pulls in fetch-driven internals).
vi.mock("@/components/org/shared/RepoDimensionModal", () => ({ RepoDimensionModal: () => null }));

const { SecurityRiskRegister } = await import("./SecurityRiskRegister");

function row(over: Partial<SecurityRegisterRow> = {}): SecurityRegisterRow {
  return {
    name: "web",
    fullName: "acme/web",
    score: 72,
    gateReason: null,
    rules: null,
    checks: [],
    issues: [],
    summary: "",
    ...over,
  };
}

const advisories = [{ fullName: "acme/web", critical: 2, high: 3, total: 12 }];

describe("SecurityRiskRegister advisories provenance (#3)", () => {
  it("real data: links to GitHub and shows no demo chip", () => {
    render(<SecurityRiskRegister org="acme" rows={[row()]} advisories={advisories} />);
    expect(screen.queryByText("demo data")).toBeNull();
    const link = screen.getByTitle(/open on GitHub/i);
    expect(link).toHaveAttribute("href", "https://github.com/acme/web/security/dependabot");
  });

  it("demo data: labels the column and suppresses the GitHub deep-link", () => {
    render(<SecurityRiskRegister org="acme" rows={[row()]} advisories={advisories} advisoriesDemo />);
    expect(screen.getByText("demo data")).toBeInTheDocument();
    expect(screen.queryByTitle(/open on GitHub/i)).toBeNull();
    // The counts still render — honestly labeled, just not linked as real GitHub state.
    expect(screen.getByTitle(/no matching advisories exist on GitHub/i)).toBeInTheDocument();
  });
});
