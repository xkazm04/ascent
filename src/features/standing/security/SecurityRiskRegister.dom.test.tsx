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
const { presentAdvisoryChips } = await import("./securityRegisterShared");

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

describe("presentAdvisoryChips — medium/low when present, never a fabricated 0 (G4)", () => {
  it("includes medium and low when they are measured and > 0", () => {
    expect(presentAdvisoryChips({ fullName: "acme/web", critical: 1, high: 2, medium: 4, low: 3, total: 10 }).map((c) => `${c.count}${c.letter}`)).toEqual(["1C", "2H", "4M", "3L"]);
  });

  it("omits unmeasured medium/low rather than printing 0", () => {
    expect(presentAdvisoryChips({ fullName: "acme/web", critical: 2, high: 3, total: 12 }).map((c) => `${c.count}${c.letter}`)).toEqual(["2C", "3H"]);
  });

  it("omits a measured 0 — chips are visible only when present", () => {
    expect(presentAdvisoryChips({ fullName: "acme/web", critical: 0, high: 0, medium: 0, low: 5, total: 5 }).map((c) => `${c.count}${c.letter}`)).toEqual(["5L"]);
  });
});

describe("SecurityRiskRegister — medium and low Dependabot counts", () => {
  it("renders medium and low chips when those counts are present", () => {
    render(<SecurityRiskRegister org="acme" rows={[row()]} advisories={[{ fullName: "acme/web", critical: 1, high: 2, medium: 4, low: 3, total: 10 }]} />);
    const link = screen.getByTitle(/open on GitHub/i);
    expect(link).toHaveTextContent(/4M/);
    expect(link).toHaveTextContent(/3L/);
    expect(link).toHaveTextContent(/1C/);
    expect(link).toHaveTextContent(/2H/);
  });

  it("does not print 0M/0L when medium and low were never measured", () => {
    render(<SecurityRiskRegister org="acme" rows={[row()]} advisories={advisories} />);
    const link = screen.getByTitle(/open on GitHub/i);
    expect(link.textContent ?? "").not.toMatch(/(?:^|[^\d])0M/);
    expect(link.textContent ?? "").not.toMatch(/(?:^|[^\d])0L/);
  });

  it("demo data still shows medium/low chips, just unlinked", () => {
    render(<SecurityRiskRegister org="acme" rows={[row()]} advisories={[{ fullName: "acme/web", critical: 0, high: 0, medium: 4, low: 2, total: 6 }]} advisoriesDemo />);
    expect(screen.queryByTitle(/open on GitHub/i)).toBeNull();
    const cell = screen.getByTitle(/no matching advisories exist on GitHub/i);
    expect(cell).toHaveTextContent(/4M/);
    expect(cell).toHaveTextContent(/2L/);
    expect(cell.textContent ?? "").not.toMatch(/(?:^|[^\d])0C/);
    expect(cell.textContent ?? "").not.toMatch(/(?:^|[^\d])0H/);
  });
});
