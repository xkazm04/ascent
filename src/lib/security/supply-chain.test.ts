// The Dependabot advisory parser is the trust boundary for the supply-chain signal — it must tally
// real severities and quietly ignore malformed entries (the API shape varies). DB/App/pool are mocked
// so importing the module never touches the network.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getOrgRollup: vi.fn(), getInstallationIdForOwner: vi.fn() }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn() }));
vi.mock("@/lib/pool", () => ({ mapPool: vi.fn(), SCAN_CONCURRENCY: 4 }));

import { countAdvisories } from "./supply-chain";

describe("countAdvisories", () => {
  it("tallies severities across the Dependabot alert shapes (case-insensitive)", () => {
    const alerts = [
      { security_advisory: { severity: "critical" } },
      { security_advisory: { severity: "HIGH" } },
      { security_vulnerability: { severity: "high" } },
      { severity: "medium" }, // top-level fallback
      { security_advisory: { severity: "low" } },
      { security_advisory: { severity: "low" } },
    ];
    expect(countAdvisories(alerts)).toEqual({ critical: 1, high: 2, medium: 1, low: 2 });
  });

  it("ignores malformed or unknown-severity entries", () => {
    const alerts = [null, "x", 42, {}, { severity: "informational" }, { security_advisory: {} }];
    expect(countAdvisories(alerts)).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});
