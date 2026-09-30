// @vitest-environment jsdom
// Docket rows are pressable list rows. A decline stays visible beside the open count.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PassportRow } from "./PassportTable";

vi.mock("@/components/github/CreateIssueModal", () => ({
  CreateIssueModal: ({ draft }: { draft: { title: string } | null }) => (draft ? <div role="dialog">{draft.title}</div> : null),
}));

const { PassportBlockersV2 } = await import("./PassportBlockers.v2");

const OBS = "Zero observability: no error tracking, structured logs, metrics, or tracing.";

function row(name: string, declined = false): PassportRow {
  return {
    fullName: `acme/${name}`,
    name,
    autoLevel: "L3",
    autoScore: 60,
    band: "beta",
    prodScore: 50,
    ci: "checks",
    tests: "partial",
    security: "policy",
    observability: "none",
    detail: {
      purpose: "",
      autoBlockers: [],
      prodBlockers: declined ? [] : [OBS],
      autoFindings: [],
      prodFindings: declined ? [] : [{ id: "prod.zero-observability", code: "zero-observability", text: OBS, severity: "block" }],
      ...(declined
        ? {
            declined: [
              {
                path: "productionReadiness.observability",
                label: "Observability",
                blocker: OBS,
                findingId: "prod.zero-observability",
              },
            ],
          }
        : {}),
      selfVerify: { build: true, test: true, lint: true, typecheck: true },
      aiInWorkflow: false,
      ciProvider: null,
      ciGates: [],
      coveragePct: null,
      criticalPathCovered: false,
      securityTools: [],
      delivery: { migrations: "none", iac: false, rollback: false },
      stack: [],
      confidence: 0.8,
    },
  };
}

describe("PassportBlockersV2", () => {
  it("opens the issue draft from the row and keeps an accepted gap beside the open count", () => {
    const { container } = render(
      <PassportBlockersV2 rows={[row("a"), row("b"), row("c", true)]} scopeLabel="all passports" org="acme" />,
    );
    expect(screen.getByText("+1 accepted")).toBeTruthy();
    expect(screen.getByText(/2 open/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Zero observability/i });
    fireEvent.click(button);
    expect(screen.getByRole("dialog").textContent).toContain("Zero observability");
    expect(container.querySelector("[data-kit='list-row'][data-selected]")).toBeTruthy();
  });
});
