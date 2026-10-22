// @vitest-environment jsdom
//
// The post-checkout return notice. It follows THIS purchase through /api/billing/checkout/status
// (confirming -> paid -> landed, or stalled / failed / expired) instead of a static claim: a return with
// no checkout id (bookmark, shared or legacy link) renders the unverified copy and never says "Payment
// received". ?credits=error still states the user was NOT charged, as an alert. Dismiss strips only the
// billing params via router.replace so the notice doesn't resurrect on reload.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { BillingReturnNotice } from "@/components/shared/credits/BillingReturnNotice";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe("BillingReturnNotice", () => {
  it("no checkout id: renders the unverified copy, never 'Payment received', asks nothing", async () => {
    render(<BillingReturnNotice status="pending" org="acme" checkoutId={null} dismissHref="/org/acme" />);
    await flush();
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("We could not confirm this payment yet");
    expect(region.textContent).not.toMatch(/payment received/i);
    expect(region.textContent).not.toContain("\u2014");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with a checkout id: paints what landed for THIS purchase", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: "landed", credits: 500, balance: 620 })));
    render(<BillingReturnNotice status="pending" org="acme" checkoutId="co_1" dismissHref="/org/acme" />);
    expect(screen.getByRole("status").textContent).not.toMatch(/payment received/i);
    await flush();
    expect(screen.getByRole("status").textContent).toContain("+500 credits, balance 620");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a stalled purchase names the order id to quote, as an alert", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ state: "stalled", orderId: "ord_9" })));
    render(<BillingReturnNotice status="pending" org="acme" checkoutId="co_1" dismissHref="/org/acme" />);
    await flush();
    const region = screen.getByRole("alert");
    expect(region.textContent).toContain("ord_9");
    expect(region.textContent).toMatch(/do not buy again/i);
  });

  it("alerts a failed checkout and states the user was NOT charged", () => {
    render(<BillingReturnNotice status="error" org="acme" checkoutId={null} dismissHref="/org/acme" />);
    const region = screen.getByRole("alert");
    expect(region.textContent).toMatch(/Checkout couldn.t be started/);
    expect(region.textContent).toContain("not charged");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dismiss hides the notice and strips the param via router.replace", () => {
    render(<BillingReturnNotice status="pending" org="acme" checkoutId={null} dismissHref="/org/acme?range=90d" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss billing notice" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/org/acme?range=90d", { scroll: false });
  });
});
