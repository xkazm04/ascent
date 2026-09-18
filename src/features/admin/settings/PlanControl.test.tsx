// @vitest-environment jsdom
//
// Pins Polar-present vs absent on the owner plan chip: "Manage billing" is a one-click Polar portal
// link when portalEnabled, and is omitted for free/self-host (the parent passes false).

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanControl } from "./PlanControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PlanControl Polar portal", () => {
  it("shows Manage billing when Polar is present", () => {
    render(<PlanControl org="acme" plan="pro" enabled={false} portalEnabled />);
    const link = screen.getByRole("link", { name: /manage billing/i });
    expect(link).toHaveAttribute("href", "/api/billing/portal?org=acme");
    expect(link.textContent).not.toMatch(/talk to sales/i);
    expect(link.textContent).not.toMatch(/refund/i);
  });

  it("omits Manage billing when Polar is absent (free / self-host)", () => {
    render(<PlanControl org="acme" plan="free" enabled={false} />);
    expect(screen.queryByRole("link", { name: /manage billing/i })).toBeNull();
    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});
