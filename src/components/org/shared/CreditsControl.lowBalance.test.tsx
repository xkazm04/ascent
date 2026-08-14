// @vitest-environment jsdom
//
// The opt-in low-balance warning (G1-07): a pre-emptive notice + one-click top-up while the balance is
// still positive, driven by a per-org threshold. Split out of CreditsControl.test.tsx — this suite is
// self-contained (its own stubFetch double covering both the credits and autorecharge-preference
// endpoints) and pins a single feature area distinct from the reconciliation/paused/a11y suites that
// remain in CreditsControl.test.tsx.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreditsControl } from "@/components/org/shared/CreditsControl";

afterEach(() => vi.restoreAllMocks());

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
    expect(screen.queryByText(/Out of credits\. Private scans are paused/)).toBeNull();
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
