// @vitest-environment jsdom
//
// PATCH /api/report/passport/overrides — the decline write — had ZERO callers: every
// decline-rendering surface in the product was fed by data no human could enter anywhere in the
// product. This control is that caller, and these tests pin the two rules it exists to hold:
// only findings the SCAN RAISED are offered (a "we could not see this" caveat is a limitation of the
// evidence, not a trade-off an owner may accept), and a decline carries a reason.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PassportDeclineControl } from "./PassportDeclineControl";
import { declineOffers } from "./passportDeclineOffers";
import type { AppPassport } from "@/lib/types";

const passport = (over: Partial<AppPassport> = {}): AppPassport =>
  ({
    passport: "app-passport",
    passportVersion: "0.4.0",
    generatedAt: "2026-09-01",
    identity: { name: "web", slug: "web", purpose: "", archetype: "team", visibility: "private", license: null },
    automationReadiness: {
      level: "L2",
      score: 40,
      blockers: ["No in-repo .ai/manifest.yaml."],
      findings: [{ id: "auto.no-manifest", code: "no-manifest", text: "No in-repo .ai/manifest.yaml.", severity: "warn" }],
    },
    productionReadiness: {
      band: "beta",
      score: 50,
      blockers: ["Zero observability.", "Enforcement (branch protection) not observable."],
      findings: [
        { id: "prod.zero-observability", code: "zero-observability", text: "Zero observability.", severity: "block" },
        // The tokenless caveat: the scan could not LOOK. Never declinable.
        { id: "prod.enforcement-not-observable", code: "enforcement-not-observable", text: "Enforcement (branch protection) not observable.", severity: "info" },
      ],
    },
    ...over,
  }) as unknown as AppPassport;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("declineOffers", () => {
  it("offers the declinable OPEN findings and never a blind-spot caveat", () => {
    const offers = declineOffers(passport());
    expect(offers.map((o) => o.path)).toEqual(["productionReadiness.observability", "automationReadiness.artifacts.manifest"]);
    expect(offers.some((o) => o.findingId === "prod.enforcement-not-observable")).toBe(false);
    // Worst first, and each carries the baseline the overlay compares against on a later scan.
    expect(offers[0]).toMatchObject({ severity: "block", code: "zero-observability" });
  });
});

describe("PassportDeclineControl", () => {
  it("does not offer the caveat the scan could not observe", () => {
    render(<PassportDeclineControl repo="acme/web" passport={passport()} />);
    expect(screen.getByText("Zero observability.")).toBeInTheDocument();
    expect(screen.queryByText("Enforcement (branch protection) not observable.")).toBeNull();
    expect(screen.queryByRole("button", { name: /branch protection/i })).toBeNull();
  });

  it("requires a reason, then PATCHes the decline with the finding's baseline (never an author)", async () => {
    render(<PassportDeclineControl repo="acme/web" passport={passport()} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept Observability" }));
    const submit = screen.getByRole("button", { name: "Accept gap" });
    expect(submit).toBeDisabled(); // no rationale = no decision
    fireEvent.change(screen.getByLabelText(/Why are you accepting/), { target: { value: "internal cron worker" } });
    fireEvent.click(submit);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/report/passport/overrides");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      repo: "acme/web",
      declined: { "productionReadiness.observability": { reason: "internal cron worker", code: "zero-observability", severity: "block" } },
    });
    // Authorship is the server's to write.
    expect(JSON.stringify(body)).not.toContain('"by"');
  });

  it("retracts a decline with an explicit null, and names who made it", () => {
    const pp = passport({
      declined: [{ path: "productionReadiness.ci", label: "CI merge gating", by: "alice", at: "2026-02-02" }],
    });
    render(<PassportDeclineControl repo="acme/web" passport={pp} />);
    expect(screen.getByTestId("passport-decline-control")).toHaveTextContent("declined by alice on 2026-02-02");
    fireEvent.click(screen.getByRole("button", { name: /Retract the decline of CI merge gating/ }));
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.declined["productionReadiness.ci"]).toBeNull();
  });

  it("asks for RE-CONFIRMATION (not a fresh decline) on a re-surfaced decision", () => {
    const pp = passport({
      declined: [
        {
          path: "productionReadiness.observability",
          label: "Observability",
          by: "alice",
          needsReconfirm: true,
          reconfirmReason: "This gap hardened since it was accepted.",
        },
      ],
    });
    render(<PassportDeclineControl repo="acme/web" passport={pp} />);
    expect(screen.getByRole("button", { name: "Re-confirm Observability" })).toBeInTheDocument();
    expect(screen.getByTestId("passport-decline-control")).toHaveTextContent("hardened since it was accepted");
  });

  it("renders nothing when there is neither a declinable finding nor a decline", () => {
    const clean = passport({
      automationReadiness: { level: "L4", score: 90, blockers: [], findings: [] } as unknown as AppPassport["automationReadiness"],
      productionReadiness: { band: "ga", score: 90, blockers: [], findings: [] } as unknown as AppPassport["productionReadiness"],
    });
    const { container } = render(<PassportDeclineControl repo="acme/web" passport={clean} />);
    expect(container.firstChild).toBeNull();
  });
});
