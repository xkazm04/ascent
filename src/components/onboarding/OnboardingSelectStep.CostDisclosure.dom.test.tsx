// @vitest-environment jsdom
//
// G1-10 (2/3 and 3/3):
//  - the cost disclosure priced only the RECURRING month and never the credits the click draws NOW;
//  - the App path committed every scanned repo to a weekly autoscan with no opt-in, so the recurring
//    cost was disclosed but never consented to.
// These pin the immediate-draw line, the opt-in default (OFF), and that the checkbox — not the
// component's existence — is what turns the recurring commitment on.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScanCostDisclosure } from "./OnboardingSelectStep.CostDisclosure";
import { getAutoWatchOptIn, resetAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";
import { immediateScanCredits } from "@/components/credit/WatchCostTail";

beforeEach(() => resetAutoWatchOptIn());

describe("immediateScanCredits — the number behind the copy", () => {
  it("is one credit per repo beyond the remaining free monthly scans", () => {
    // The import route reserves ONE credit per repo and its capacity is balance + allowanceRemaining;
    // within-allowance scans are free (scan-credit.ts), so the allowance comes off the top.
    expect(immediateScanCredits(5, { unlimited: false, allowanceRemaining: 2 })).toBe(3);
    expect(immediateScanCredits(3, { unlimited: false, allowanceRemaining: 0 })).toBe(3);
    expect(immediateScanCredits(2, { unlimited: false, allowanceRemaining: 9 })).toBe(0);
  });

  it("is unstated (null) when it cannot be backed: unknown balance or an unlimited plan", () => {
    expect(immediateScanCredits(5, null)).toBeNull();
    expect(immediateScanCredits(5, { unlimited: true, allowanceRemaining: 0 })).toBeNull();
  });
});

describe("onboarding cost disclosure at the commit point", () => {
  it("states the credits the click draws NOW, beside the balance", () => {
    render(
      <ScanCostDisclosure
        count={3}
        sourceInstallId="42"
        credit={{ balance: 40, unlimited: false, allowanceRemaining: 0 }}
      />,
    );
    expect(screen.getByText(/this scan draws up to/)).toHaveTextContent(/draws up to\s*3\s*credits now/);
    expect(screen.getByText(/balance:/)).toHaveTextContent(/balance:\s*40/);
  });

  it("says the scan is covered when the free monthly allowance absorbs it", () => {
    render(
      <ScanCostDisclosure
        count={2}
        sourceInstallId="42"
        credit={{ balance: 0, unlimited: false, allowanceRemaining: 5 }}
      />,
    );
    expect(screen.getByText(/covered by your free monthly scans/)).toBeInTheDocument();
    expect(screen.queryByText(/draws up to/)).toBeNull();
  });

  it("defaults to a ONE-TIME scan — no recurring autoscan is committed unless the box is ticked", () => {
    render(
      <ScanCostDisclosure
        count={3}
        sourceInstallId="42"
        credit={{ balance: 40, unlimited: false, allowanceRemaining: 0 }}
      />,
    );
    // W6b added a second checkbox (fast preview first) above this one — target the autoscan opt-in
    // by its label, not by role alone.
    const box = screen.getByRole("checkbox", { name: /Also autoscan/i });
    expect(box).not.toBeChecked();
    expect(getAutoWatchOptIn()).toBe(false);
    expect(screen.getByText(/One-time scan/)).toBeInTheDocument();
    expect(screen.queryByText(/credits\/month/)).toBeNull();

    fireEvent.click(box);
    expect(getAutoWatchOptIn()).toBe(true);
    // weekly ≈ 4 runs/month × 3 repos = 12 credits/month, now that it was explicitly opted into.
    expect(screen.getByText(/prepaid credits\/month/)).toHaveTextContent(/12\s*prepaid credits\/month/);
    expect(screen.queryByText(/One-time scan/)).toBeNull();
  });

  // G7-17: the public-handle path stopped being a preview — it runs a real scan against the free
  // monthly allowance. The reassurance must promise a FREE LIVE scan, and must not describe a real
  // result as illustrative; the "no credit figures" half of the contract is unchanged.
  it("promises a free LIVE scan (and no credit figures) off the App path", () => {
    render(<ScanCostDisclosure count={3} sourceInstallId={null} credit={null} />);
    expect(screen.getByText(/Free live scan/)).toBeInTheDocument();
    expect(screen.getByText(/free monthly scan allowance/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/preview/i);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/draws up to/)).toBeNull();
  });

  it("quotes no number when the balance is unknown (a preview run draws nothing)", () => {
    render(<ScanCostDisclosure count={3} sourceInstallId="42" credit={null} />);
    expect(screen.queryByText(/draws up to/)).toBeNull();
    expect(screen.queryByText(/balance:/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
