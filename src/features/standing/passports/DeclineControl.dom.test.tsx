// @vitest-environment jsdom
//
// Passport 0.4.0's WRITE half. Everything about declining a gap shipped except the ability to do it:
// the allow-list, the PATCH route, the re-confirmation window and three read surfaces all existed
// while no UI could create a decline, so an owner's accepted trade-off re-litigated itself on every
// scan. These pin the four things that make the control trustworthy rather than merely present:
//
//   1. it appears on an ALLOW-LISTED blocker,
//   2. it does NOT appear on an evidence limitation (declining one would silence a limit of our own
//      evidence, not accept a real trade-off — the reason DECLINABLE_PATHS is an allow-list),
//   3. the decline payload is a merge PATCH at ONE field path, carrying the baseline a later scan
//      needs to notice the gap has changed,
//   4. retract sends the route's own `null` retraction.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PassportDetail } from "./PassportRowDetail";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// The org-decision widget is a separate subsystem with its own route; out of scope here.
vi.mock("@/components/org/DecisionControl", () => ({ DecisionControl: () => null }));

const { PassportRowDetail } = await import("./PassportRowDetail");

const OBS = {
  id: "prod.zero-observability",
  code: "zero-observability",
  text: "Zero observability: no error tracking, structured logs, metrics, or tracing.",
  severity: "block" as const,
};
/** A real minted finding that is deliberately NOT declinable: it reports what the SCAN could not see. */
const TOKENLESS = {
  id: "prod.enforcement-not-observable",
  code: "enforcement-not-observable",
  text: "Enforcement (branch protection) not observable on this scan.",
  severity: "info" as const,
};

function detail(over: Partial<PassportDetail> = {}): PassportDetail {
  return {
    purpose: "Internal cron worker",
    autoBlockers: [],
    prodBlockers: [],
    selfVerify: { build: true, test: true, lint: true, typecheck: true },
    aiInWorkflow: false,
    ciProvider: "github-actions",
    ciGates: [],
    coveragePct: null,
    criticalPathCovered: false,
    securityTools: [],
    delivery: { migrations: "versioned", iac: false, rollback: false },
    stack: [],
    confidence: 0.8,
    ...over,
  };
}

const render1 = (d: PassportDetail) =>
  render(<PassportRowDetail fullName="acme/web" detail={d} org="acme" decisions={{}} />);

/** The single fetch call this control made, parsed. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) };
}

function stubFetch(ok = true, error?: string) {
  const f = vi.fn(async () => ({ ok, json: async () => (ok ? { ok: true } : { error }) }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("DeclineControl — declining a blocker by choice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers the control on an allow-listed blocker and withholds it on an evidence limitation", () => {
    render1(detail({ prodBlockers: [OBS.text, TOKENLESS.text], prodFindings: [OBS, TOKENLESS] }));
    // One control, for the one declinable finding — not two.
    expect(screen.getAllByRole("button", { name: "Decline by choice" })).toHaveLength(1);
    // Both blockers are still listed; only the judgment affordance differs.
    expect(screen.getByText(/not observable on this scan/)).toBeTruthy();
  });

  it("shows no control at all for a pre-0.4.0 row whose blockers have no minted ids", () => {
    render1(detail({ prodBlockers: [OBS.text] }));
    expect(screen.queryByRole("button", { name: "Decline by choice" })).toBeNull();
  });

  it("PATCHes one field path with the reason plus the baseline a later scan compares against", async () => {
    const f = stubFetch();
    render1(detail({ prodBlockers: [OBS.text], prodFindings: [OBS] }));

    fireEvent.click(screen.getByRole("button", { name: "Decline by choice" }));
    fireEvent.change(screen.getByLabelText(/Why is this gap acceptable here\?/), {
      target: { value: "Failures page via the platform." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const { url, method, body } = sentBody(f);
    expect(url).toBe("/api/report/passport/overrides");
    expect(method).toBe("PATCH");
    expect(body.repo).toBe("acme/web");
    // The path is the observability sub-scale — the axis the blocker was read on — not the sibling
    // stack.monitoring path that carries the same finding id.
    expect(Object.keys(body.declined)).toEqual(["productionReadiness.observability"]);
    const entry = body.declined["productionReadiness.observability"];
    expect(entry.reason).toBe("Failures page via the platform.");
    expect(entry.code).toBe("zero-observability");
    expect(entry.severity).toBe("block");
    // Without `at` the 365-day re-confirmation window can never fire for a UI-made decline.
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The overlay is read-time, so a refresh IS the update — no manual reload.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps the reason optional — an accepted trade-off is recordable without prose", async () => {
    const f = stubFetch();
    render1(detail({ prodBlockers: [OBS.text], prodFindings: [OBS] }));

    fireEvent.click(screen.getByRole("button", { name: "Decline by choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(sentBody(f).body.declined["productionReadiness.observability"]).not.toHaveProperty("reason");
  });

  it("retracts a recorded decline with the route's own null, from the Accepted-by-choice list", async () => {
    const f = stubFetch();
    render1(
      detail({
        declined: [{ path: "stack.monitoring.errorTracking", label: "Error tracking", blocker: OBS.text, at: "2026-02-01" }],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Retract" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(sentBody(f).body).toEqual({ repo: "acme/web", declined: { "stack.monitoring.errorTracking": null } });
  });

  it("renders the route's refusal inline rather than throwing an alert", async () => {
    stubFetch(false, "Owner role required.");
    render1(detail({ prodBlockers: [OBS.text], prodFindings: [OBS] }));

    fireEvent.click(screen.getByRole("button", { name: "Decline by choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await screen.findByText("Owner role required.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
