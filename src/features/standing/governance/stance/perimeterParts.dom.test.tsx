// @vitest-environment jsdom
//
// Advisory stance findings are already computed (`evaluateStanceCompliance`); the node used to
// drop them (`!f.advisory`), so a declared-not-checked path zone was invisible on the repo it
// binds. Pin that the node shows them, and that they are not painted as a breach.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RepoStanceCompliance, StanceFinding } from "@/lib/org/stance";
import { PATH_ZONE_ADVISORY_LABEL } from "@/lib/org/stance";

const { RepoNode } = await import("./perimeterParts");

const advisory: StanceFinding = {
  code: "no-ai-zone-path",
  advisory: true,
  message: `1 declared no-AI path zone (prisma/migrations/**). ${PATH_ZONE_ADVISORY_LABEL}`,
};

const blocking: StanceFinding = {
  code: "undeclared-tool",
  advisory: false,
  message: "copilot observed in PR attribution but not on the stance's permitted-tool list.",
};

function repo(findings: StanceFinding[]): RepoStanceCompliance {
  return {
    name: "api",
    fullName: "acme/api",
    level: "L3",
    overall: 62,
    tier: "T1",
    ack: "current",
    ackedVersion: 1,
    provenancePct: null,
    sealed: false,
    findings,
    compliant: findings.every((f) => f.advisory),
  };
}

const props = { org: "acme", version: 1, canAck: false };

describe("RepoNode — advisory findings are visible", () => {
  it("shows an advisory-only finding on the node, not as a breach", () => {
    render(<RepoNode repo={repo([advisory])} {...props} />);
    expect(screen.getByText("1 advisory")).toBeTruthy();
    expect(screen.getByTitle(advisory.message)).toBeTruthy();
    expect(screen.queryByText(/finding/)).toBeNull();
  });

  it("keeps non-advisory findings on the danger count", () => {
    render(<RepoNode repo={repo([blocking])} {...props} />);
    expect(screen.getByText("1 finding")).toBeTruthy();
    expect(screen.queryByText(/advisory/)).toBeNull();
  });

  it("shows both when a node carries a breach and an advisory reminder", () => {
    render(<RepoNode repo={repo([blocking, advisory])} {...props} />);
    expect(screen.getByText("1 finding")).toBeTruthy();
    expect(screen.getByText("1 advisory")).toBeTruthy();
    expect(screen.getByTitle(/prisma\/migrations/)).toBeTruthy();
  });
});
