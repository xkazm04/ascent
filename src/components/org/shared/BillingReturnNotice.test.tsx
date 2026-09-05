// @vitest-environment jsdom
//
// The post-checkout return notice (checkout-plans-polar 2026-07-16 #1): the ?credits=pending|error
// redirect param finally has a consumer. Pending must reassure (paid, fulfilment in flight) as an
// announced status; error must state clearly that the user was NOT charged, as an alert. Dismiss
// strips the param via router.replace so the notice doesn't resurrect on reload.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BillingReturnNotice } from "@/components/org/shared/BillingReturnNotice";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

afterEach(() => vi.clearAllMocks());

describe("BillingReturnNotice", () => {
  it("announces 'payment received, credits arriving' for the pending return", () => {
    render(<BillingReturnNotice status="pending" dismissHref="/org/acme" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Payment received");
    expect(region.textContent).toMatch(/within a\s+minute/);
  });

  it("alerts a failed checkout and states the user was NOT charged", () => {
    render(<BillingReturnNotice status="error" dismissHref="/org/acme" />);
    const region = screen.getByRole("alert");
    expect(region.textContent).toMatch(/Checkout couldn.t be started/);
    expect(region.textContent).toContain("not charged");
  });

  it("dismiss hides the notice and strips the param via router.replace", () => {
    render(<BillingReturnNotice status="pending" dismissHref="/org/acme?range=90d" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss billing notice" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/org/acme?range=90d", { scroll: false });
  });
});
