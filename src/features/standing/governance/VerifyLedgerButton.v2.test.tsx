// @vitest-environment jsdom

// The Prism verify control reports the chain in words. It does not recolor the sentence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VerifyLedgerButtonV2 } from "./VerifyLedgerButton.v2";

afterEach(() => vi.unstubAllGlobals());

function stub(body: Record<string, unknown>, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })),
  );
}

describe("VerifyLedgerButtonV2", () => {
  it("says the chain is intact, with the recomputed counts", async () => {
    stub({ chainOk: true, seals: [{}, {}], unsealedDays: ["2026-09-30"], sealBacklogRemaining: 0 });
    render(<VerifyLedgerButtonV2 slug="kiro" />);
    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));
    await waitFor(() => expect(screen.getByText(/Chain intact/)).toBeTruthy());
    expect(screen.getByText(/2 days recomputed/)).toBeTruthy();
    expect(screen.getByText(/1 not yet chained/)).toBeTruthy();
    expect(screen.getByText(/Healthy:/)).toBeTruthy();
  });

  it("says the chain is not intact and names a backlog", async () => {
    stub({ chainOk: false, seals: [{}], unsealedDays: [], sealBacklogRemaining: 2 });
    render(<VerifyLedgerButtonV2 slug="kiro" />);
    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));
    await waitFor(() => expect(screen.getByText(/Chain NOT intact/)).toBeTruthy());
    expect(screen.getByText(/2 beyond the next pass/)).toBeTruthy();
    expect(screen.getByText(/At risk:/)).toBeTruthy();
  });

  it("shows the verifier error as text", async () => {
    stub({ error: "nope" }, false);
    render(<VerifyLedgerButtonV2 slug="kiro" />);
    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));
    await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
  });
});
