// @vitest-environment jsdom
//
// A wired-component DOM test for the destructive-action gate (bug-ui-scan-2026-07-09 theme T13). Unit
// tests pin the confirm COPY; this pins the WIRING — that clicking "Re-test" no longer spends a weekly
// scan slot on the spot. FreshnessControl is the cleanest site to prove it against: `onRetest` is a
// plain callback (no fetch to mock), so a spy that stays uncalled until the confirm IS the proof that
// the quota-spending action doesn't fire on the first click.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ScanReport } from "@/lib/types";
import { FreshnessControl } from "./FreshnessControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// FreshnessControl reads only scannedAt + repo.{owner,name,headSha}; the rest of ScanReport is irrelevant.
const report = {
  scannedAt: new Date().toISOString(),
  repo: { owner: "acme", name: "web", headSha: undefined },
} as unknown as ScanReport;

describe("FreshnessControl Re-test — the scan slot isn't spent until confirmed", () => {
  it("opens a scope-stating confirm on the first click and does NOT re-scan yet", () => {
    const onRetest = vi.fn();
    render(<FreshnessControl report={report} onRetest={onRetest} />);

    // No dialog before the click, and the metered action has not run.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Re-test" }));

    // The dialog is up and names the repo — but onRetest (the quota spend) has NOT fired.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Re-scan acme\/web\?/)).toBeInTheDocument();
    expect(onRetest).not.toHaveBeenCalled();
  });

  it("fires the re-scan only after the explicit Confirm", () => {
    const onRetest = vi.fn();
    render(<FreshnessControl report={report} onRetest={onRetest} />);

    fireEvent.click(screen.getByRole("button", { name: "Re-test" }));
    expect(onRetest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Re-scan now" }));
    expect(onRetest).toHaveBeenCalledTimes(1);
  });

  it("Cancel backs out without ever spending a slot", () => {
    const onRetest = vi.fn();
    render(<FreshnessControl report={report} onRetest={onRetest} />);

    fireEvent.click(screen.getByRole("button", { name: "Re-test" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRetest).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
