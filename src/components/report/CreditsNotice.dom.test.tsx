// @vitest-environment jsdom
//
// The out-of-credits wall: what a 402 from the scan credit gate must render. The contract is that
// the only actions offered are ones that can actually clear the block (credits), never a retry that
// re-trips the same gate — and that the balance the server reported is shown, not swallowed.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreditsBlocked, creditsOrgHref } from "./CreditsNotice";
import { CTA_PRIMARY } from "@/lib/ui";

describe("creditsOrgHref", () => {
  it("derives the owning org's dashboard from the requested repo, in any accepted form", () => {
    expect(creditsOrgHref("Acme/App")).toBe("/org/acme");
    expect(creditsOrgHref("https://github.com/Acme/App")).toBe("/org/acme");
    expect(creditsOrgHref("github.com/acme/app.git")).toBe("/org/acme");
  });

  it("returns null when no owner can be read", () => {
    expect(creditsOrgHref("")).toBeNull();
  });
});

describe("CreditsBlocked", () => {
  it("names the balance and leads to the org's credits control", () => {
    render(<CreditsBlocked message="This organization is out of private-scan credits." balance={0} repo="acme/app" />);
    const add = screen.getByRole("link", { name: /add credits/i });
    expect(add).toHaveAttribute("href", "/org/acme");
    expect(add.className).toBe(CTA_PRIMARY);
    expect(document.body.textContent).toContain("0 scan credits left.");
    // A retry cannot clear a credit refusal, so it is not offered.
    expect(screen.queryByRole("link", { name: /try again/i })).toBeNull();
  });

  it("falls back to the plans page as the primary when the owner is unknown", () => {
    render(<CreditsBlocked message="Out of credits." balance={1} />);
    expect(screen.queryByRole("link", { name: /add credits/i })).toBeNull();
    expect(screen.getByRole("link", { name: /see plans/i }).className).toBe(CTA_PRIMARY);
    expect(document.body.textContent).toContain("1 scan credit left.");
  });
});
