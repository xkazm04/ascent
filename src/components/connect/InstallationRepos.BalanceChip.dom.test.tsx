// @vitest-environment jsdom
//
// G1-10 (1/3): the connect/import screen — the one place a user can flip EVERY private repo to a
// recurring billable autoscan — showed no credit balance anywhere. These pin that the balance is now
// visible at that commitment point AND that it degrades to NOTHING (never "NaN credits", never a
// flash of a zero balance) for a viewer whose balance can't be read: anonymous, DB-less, or no access.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BalanceChip } from "./InstallationRepos.BalanceChip";

describe("connect balance chip", () => {
  it("shows the prepaid balance when one was read", () => {
    render(<BalanceChip credit={{ balance: 42, unlimited: false, allowanceRemaining: 0 }} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByTitle(/Prepaid private-scan credits/)).toHaveTextContent(/42\s*credits/);
  });

  it("renders nothing at all when no balance could be read (anonymous / DB-less)", () => {
    const { container } = render(<BalanceChip credit={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(container.textContent).not.toMatch(/NaN|credits/);
  });

  it("renders the unlimited variant instead of a number for an org on the unlimited tier", () => {
    render(<BalanceChip credit={{ balance: 0, unlimited: true, allowanceRemaining: 0 }} />);
    expect(screen.getByText(/Credits · Unlimited/)).toBeInTheDocument();
    // A 0 balance must never be shown as "0 credits" for an unlimited org.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("does not cry 'paused' at a 0 balance while free monthly scans remain", () => {
    render(<BalanceChip credit={{ balance: 0, unlimited: false, allowanceRemaining: 3 }} />);
    expect(screen.queryByText(/paused/)).toBeNull();
    expect(screen.getByTitle(/Prepaid private-scan credits/)).toHaveTextContent(/\+3 free/);
  });

  it("marks the paused state with a word, not colour alone, when both the balance and allowance are spent", () => {
    render(<BalanceChip credit={{ balance: 0, unlimited: false, allowanceRemaining: 0 }} />);
    expect(screen.getByTitle(/Prepaid private-scan credits/)).toHaveTextContent(/⚠ paused/);
  });
});
