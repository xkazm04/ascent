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
    measured: true,
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

describe("SecurityRiskRegister — an unmeasured repo never prints the fail-closed 0", () => {
  it("renders the D9 cell as a void, not as a clickable score of 0", () => {
    render(<SecurityRiskRegister org="acme" rows={[row({ name: "old", fullName: "acme/old", score: 0, measured: false, gateReason: "D9 not measured" })]} advisories={null} />);
    // No score button, and nothing anywhere claims a reading of 0 for this repo.
    expect(screen.queryByRole("button", { name: /security score/i })).toBeNull();
    expect(screen.getByTitle(/Security \(D9\) — No measurement/i)).toBeInTheDocument();
    // The gate still FAILS — the verdict is unchanged, only the fabricated number is gone.
    expect(screen.getByText(/D9 not measured/)).toBeInTheDocument();
    expect(screen.getByTitle(/D9 battery — No measurement/i)).toBeInTheDocument();
  });

  it("a measured repo keeps its clickable score", () => {
    render(<SecurityRiskRegister org="acme" rows={[row()]} advisories={null} />);
    expect(screen.getByRole("button", { name: /web security score 72, open detail/i })).toBeInTheDocument();
  });
});
