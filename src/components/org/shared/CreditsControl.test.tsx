// @vitest-environment jsdom
//
// Two money-surface behaviors: opening the popover must RECONCILE the chip from the authoritative
// server balance the same fetch already returns (it was throwing d.balance away, so the chip stayed
// stale after scans spent credits), and the "paused / out of credits" state must be signalled by more
// than color (WCAG 1.4.1) — a text marker + an aria-label, not just an amber tint.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreditsControl } from "@/components/org/shared/CreditsControl";

afterEach(() => vi.restoreAllMocks());

describe("CreditsControl balance reconciliation", () => {
  it("self-heals the stale chip from the server balance when the popover opens", async () => {
    // SSR seeded the chip at 10; the server now says 3 (private scans spent credits elsewhere this
    // session). Opening the popover fetches the ledger + balance — the balance must win, not be discarded.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: 3, unlimited: false, plan: "free", allowanceRemaining: 5, ledger: [] }),
      }),
    );

    render(<CreditsControl org="acme" initialBalance={10} unlimited={false} grantsEnabled={false} allowanceRemaining={5} />);

    // Before opening: the chip shows the stale SSR balance.
    expect(screen.getByRole("button", { name: "10 credits" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "10 credits" }));

    // After the open-fetch resolves, the chip reflects the fresh server balance.
    await waitFor(() => expect(screen.getByRole("button", { name: "3 credits" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "10 credits" })).toBeNull();
  });
});

describe("CreditsControl grant error resets on reopen (credits-entitlements #4)", () => {
  it("clears a stale 'Top-up failed.' from a prior session when the popover is reopened", async () => {
    // Ledger loads fine on open; the grant POST fails. The failure message must NOT survive a
    // close→reopen — a fresh popover accusing the user of a failure that already passed is confusing.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        typeof url === "string" && url.includes("/grant")
          ? Promise.resolve({ ok: false, json: async () => ({ error: "Top-up failed." }) })
          : Promise.resolve({ ok: true, json: async () => ({ balance: 100, ledger: [] }) }),
      ),
    );

    render(<CreditsControl org="acme" initialBalance={100} unlimited={false} grantsEnabled />);

    const trigger = screen.getByRole("button", { name: "100 credits" });
    fireEvent.click(trigger); // open
    fireEvent.click(screen.getByRole("button", { name: "+50" })); // failing grant

    await waitFor(() => expect(screen.getByText("Top-up failed.")).toBeInTheDocument());

    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // reopen — the stale error must be gone
    expect(screen.queryByText("Top-up failed.")).toBeNull();
  });
});

describe("CreditsControl paused state (not color-alone)", () => {
  it("marks the paused chip with text + an aria-label, beyond the amber tint", () => {
    // balance 0 AND no free allowance left → paused.
    render(<CreditsControl org="acme" initialBalance={0} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);

    const trigger = screen.getByRole("button", { name: /out of credits, private scanning paused/i });
    // A visible, non-color cue on the collapsed trigger itself.
    expect(trigger.textContent).toContain("paused");
    expect(screen.getByText("⚠")).toBeInTheDocument();
  });

  it("does NOT show the paused cue while the monthly allowance still covers scans", () => {
    // balance 0 but allowanceRemaining 4 → covered by allowance, not paused (no false top-up nudge).
    render(<CreditsControl org="acme" initialBalance={0} unlimited={false} grantsEnabled={false} allowanceRemaining={4} />);
    expect(screen.queryByRole("button", { name: /paused/i })).toBeNull();
    expect(screen.getByRole("button", { name: "0 credits" })).toBeInTheDocument();
  });
});
