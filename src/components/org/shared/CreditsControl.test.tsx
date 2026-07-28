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

describe("CreditsControl allowance reconciliation (credits-entitlements 2026-07-16 #1)", () => {
  it("refreshes allowanceRemaining alongside balance, so the paused state self-heals on open", async () => {
    // SSR said: balance 0, 5 free scans left → "covered by allowance". Mid-session the org burned its
    // last free scans: the server now says allowanceRemaining 0. Opening the popover must surface the
    // real paused state — the old code threw d.allowanceRemaining away and kept claiming free scans.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: 0, unlimited: false, plan: "free", allowanceRemaining: 0, ledger: [] }),
      }),
    );

    render(<CreditsControl org="acme" initialBalance={0} unlimited={false} grantsEnabled={false} allowanceRemaining={5} />);

    // Before opening: the SSR snapshot says the allowance still covers scans (chip not paused).
    fireEvent.click(screen.getByRole("button", { name: "0 credits" }));

    // After the open-fetch resolves, the frozen allowance is reconciled: paused, no "free scans left".
    await waitFor(() =>
      expect(screen.getByText(/Out of credits — private scans are paused/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/free scans? left this month/)).toBeNull();
  });

  it("surfaces a month-rollover reset: a stale 'paused' chip recovers when the server reports fresh allowance", async () => {
    // SSR rendered paused (balance 0, allowance 0); the UTC month rolled over mid-session and the
    // server now reports 5 free scans. The chip must stop crying "paused" after the popover re-read.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: 0, unlimited: false, plan: "free", allowanceRemaining: 5, ledger: [] }),
      }),
    );

    render(<CreditsControl org="acme" initialBalance={0} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);

    fireEvent.click(screen.getByRole("button", { name: /paused/i }));
    await waitFor(() => expect(screen.getByText(/5 free scans left this month/)).toBeInTheDocument());
    expect(screen.queryByText(/Out of credits — private scans are paused/)).toBeNull();
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

describe("CreditsControl low-balance warning (G1-07)", () => {
  /** Fake both popover fetches: the credits read and the low-balance preference read. */
  function stubFetch(pref: unknown, credits: Record<string, unknown> = {}) {
    const put = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/api/billing/autorecharge")) {
          if (init?.method === "PUT") {
            put(JSON.parse(String(init.body)));
            return { ok: true, json: async () => ({ ok: true, pref: JSON.parse(String(init.body)) }) };
          }
          return { ok: true, json: async () => ({ pref, source: "stored", chargesAutomatically: false }) };
        }
        return {
          ok: true,
          json: async () => ({ balance: 4, unlimited: false, allowanceRemaining: 0, ledger: [], ...credits }),
        };
      }),
    );
    return put;
  }

  it("warns BEFORE the hard stop once the balance reaches the org's stored threshold", async () => {
    stubFetch({ enabled: true, threshold: 5, packProductId: null });
    render(<CreditsControl org="acme" initialBalance={4} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);
    fireEvent.click(screen.getByRole("button", { name: "4 credits" }));
    // Balance is still POSITIVE — this is the pre-emptive state, not the existing paused chip.
    await waitFor(() => expect(screen.getByText(/Running low/)).toBeInTheDocument());
    expect(screen.queryByText(/Out of credits — private scans are paused/)).toBeNull();
  });

  it("stays silent above the threshold", async () => {
    stubFetch({ enabled: true, threshold: 5, packProductId: null }, { balance: 40 });
    render(<CreditsControl org="acme" initialBalance={40} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);
    fireEvent.click(screen.getByRole("button", { name: "40 credits" }));
    await waitFor(() => expect(screen.getByText(/Warn me before I run out/)).toBeInTheDocument());
    expect(screen.queryByText(/Running low/)).toBeNull();
  });

  it("fires NOTHING when the org hasn't opted in, even at 1 credit left", async () => {
    stubFetch({ enabled: false, threshold: 5, packProductId: null }, { balance: 1 });
    render(<CreditsControl org="acme" initialBalance={1} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);
    fireEvent.click(screen.getByRole("button", { name: "1 credits" }));
    await waitFor(() => expect(screen.getByText(/Warn me before I run out/)).toBeInTheDocument());
    expect(screen.queryByText(/Running low/)).toBeNull();
  });

  it("never claims it will buy credits by itself (no stored payment method exists)", async () => {
    stubFetch({ enabled: true, threshold: 5, packProductId: null });
    render(<CreditsControl org="acme" initialBalance={4} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);
    fireEvent.click(screen.getByRole("button", { name: "4 credits" }));
    // Re-query after awaiting: the section remounts when the stored preference lands, so the node the
    // find resolved with can already be detached by assertion time.
    await screen.findByText(/doesn't buy credits for you/);
    await waitFor(() => expect(screen.getByText(/doesn't buy credits for you/)).toBeInTheDocument());
  });

  it("PUTs the edited preference and adopts what the server echoes back", async () => {
    const put = stubFetch({ enabled: false, threshold: 5, packProductId: null }, { balance: 4 });
    render(<CreditsControl org="acme" initialBalance={4} unlimited={false} grantsEnabled={false} allowanceRemaining={0} />);
    fireEvent.click(screen.getByRole("button", { name: "4 credits" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /Warn me before I run out/ }));
    fireEvent.change(screen.getByLabelText("at"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith({ org: "acme", enabled: true, threshold: 9, packProductId: null }));
    // The saved preference now governs the UI: 4 <= 9, so the warning appears.
    await waitFor(() => expect(screen.getByText(/your alert is set at 9/)).toBeInTheDocument());
  });
});

describe("CreditsControl a11y reach (credits-entitlements 2026-07-16 #5)", () => {
  it("explains the trigger via an accessible DESCRIPTION (not title alone), keeping the visible name", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CreditsControl org="acme" initialBalance={7} unlimited={false} grantsEnabled={false} allowanceRemaining={5} />);
    const trigger = screen.getByRole("button", { name: "7 credits" }); // name unchanged
    expect(trigger).toHaveAccessibleDescription("Prepaid private-scan credits");
  });

  it("gives the unlimited chip a screen-reader-reachable explanation (title tooltips never reach AT/touch)", () => {
    render(<CreditsControl org="acme" initialBalance={0} unlimited={true} grantsEnabled={false} />);
    expect(screen.getByText(/Enterprise plan, private scans are unlimited/)).toBeInTheDocument();
  });

  it("announces a failed top-up via a live region (matching the ledger states' aria-live pattern)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) =>
        String(url).includes("/grant")
          ? { ok: false, json: async () => ({ error: "Top-up failed." }) }
          : { ok: true, json: async () => ({ balance: 0, ledger: [] }) },
      ),
    );
    render(<CreditsControl org="acme" initialBalance={0} unlimited={false} grantsEnabled={true} allowanceRemaining={0} />);
    fireEvent.click(screen.getByRole("button", { name: /0 credits/ }));
    fireEvent.click(await screen.findByRole("button", { name: "+50" }));
    const err = await screen.findByText("Top-up failed.");
    expect(err).toHaveAttribute("aria-live", "polite");
  });
});
