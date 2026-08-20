// @vitest-environment jsdom
//
// Passport 0.4.0 render half: `aggregateBlockers` stopped subtracting declines from a bucket (it
// returns `declinedRepos` beside `repos`), and this panel must not put the subtraction back. A
// declined gap has to stay VISIBLE as its own mark and its own count — otherwise the display re-hides
// exactly what the aggregation change exists to expose, and the blocker every team has accepted still
// looks like the blocker nobody has.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PassportRow } from "./PassportTable";

// The issue-filing modal is fetch/dialog-driven and out of scope here.
vi.mock("@/components/github/CreateIssueModal", () => ({ CreateIssueModal: () => null }));

const { PassportBlockerPareto } = await import("./PassportBlockerPareto");

const OBS = "Zero observability: no error tracking, structured logs, metrics, or tracing.";

/** A row whose production axis carries one finding, optionally declined by its owner. */
function row(name: string, opts: { open?: boolean; declined?: "standing" | "resurfaced" } = {}): PassportRow {
  const open = opts.open ?? !opts.declined;
  return {
    fullName: `acme/${name}`,
    name,
    autoLevel: "L3", autoScore: 60, band: "beta", prodScore: 50,
    ci: "checks", tests: "partial", security: "policy", observability: "none",
    detail: {
      purpose: "",
      autoBlockers: [],
      prodBlockers: open ? [OBS] : [],
      autoFindings: [],
      prodFindings: open ? [{ id: "prod.zero-observability", code: "zero-observability", text: OBS, severity: "block" as const }] : [],
      ...(opts.declined
        ? {
            declined: [
              {
                path: "productionReadiness.observability",
                label: "Observability",
                blocker: OBS,
                findingId: "prod.zero-observability",
                ...(opts.declined === "resurfaced" ? { needsReconfirm: true, reconfirmReason: "aged out" } : {}),
              },
            ],
          }
        : {}),
      selfVerify: { build: true, test: true, lint: true, typecheck: true },
      aiInWorkflow: false, ciProvider: null, ciGates: [], coveragePct: null, criticalPathCovered: false,
      securityTools: [], delivery: { migrations: "none", iac: false, rollback: false }, stack: [], confidence: 0.8,
    },
  };
}

const panel = (rows: PassportRow[]) =>
  render(<PassportBlockerPareto rows={rows} scopeLabel="all repos" org="acme" />);

describe("PassportBlockerPareto — declines are shown, not folded in", () => {
  it("renders the declined count as its own mark beside the open count", () => {
    panel([row("a"), row("b"), row("c", { declined: "standing" }), row("d", { declined: "standing" })]);
    // Open count is the solid population only — 2, not 4.
    expect(screen.getByText("2")).toBeTruthy();
    // The two accepted repos are still on the row, as their own figure.
    expect(screen.getByText("+2 accepted")).toBeTruthy();
    // One hollow mark per declined repo, each naming its repo.
    expect(screen.getByTitle("c — accepted by choice")).toBeTruthy();
    expect(screen.getByTitle("d — accepted by choice")).toBeTruthy();
  });

  it("explains the hollow mark in the intro only when there is one", () => {
    const { unmount } = panel([row("a"), row("b", { declined: "standing" })]);
    expect(screen.getByText(/hollow one is a repo whose owner has accepted the gap/)).toBeTruthy();
    unmount();
    panel([row("a")]);
    expect(screen.queryByText(/hollow one/)).toBeNull();
  });

  it("does not double-count a re-surfaced decline (it is already open)", () => {
    // `c` was declined but the decision needs re-confirming, so the overlay left the blocker OPEN.
    panel([row("a"), row("c", { open: true, declined: "resurfaced" })]);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText(/accepted$/)).toBeNull();
  });
});
