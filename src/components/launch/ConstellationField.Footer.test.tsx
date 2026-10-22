// @vitest-environment jsdom
//
// The card's footer renders the scan outcome's sentence and its ONE remedy.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emptyRoster, foldStreamFrame } from "@/components/org/shared/scanRunRosterModel";
import { ConstellationFooter } from "./ConstellationField.Footer";
import { fleetScanOutcome } from "./fleetScanOutcomeModel";
import type { Constellation } from "./fleetMapStars";

afterEach(() => cleanup());
const c: Constellation = { id: 1, login: "acme", status: "done", repos: [] };

describe("ConstellationFooter", () => {
  it("an out-of-credits run links to /pricing with the server's own sentence", () => {
    const o = fleetScanOutcome("acme", emptyRoster(), "Out of scan credits: 3 watched repos couldn't be scanned.", null);
    render(<ConstellationFooter c={c} overflow={0} scanOutcome={o} />);
    expect(screen.getByRole("alert").textContent).toBe("Out of scan credits: 3 watched repos couldn't be scanned.");
    expect(screen.getByRole("link", { name: "Add credits" }).getAttribute("href")).toBe("/pricing");
  });

  it("a failed repo offers Retry, which calls back once", () => {
    const roster = foldStreamFrame(emptyRoster(), "repo", { repo: "acme/c", error: "boom" });
    const onRetryFailed = vi.fn();
    render(<ConstellationFooter c={c} overflow={0} scanOutcome={fleetScanOutcome("acme", roster, null, null)} onRetryFailed={onRetryFailed} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry 1 failed/ }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  it("a clean run says nothing and keeps the overflow line", () => {
    const roster = foldStreamFrame(emptyRoster(), "repo", { repo: "acme/a", overall: 70 });
    render(<ConstellationFooter c={c} overflow={4} scanOutcome={fleetScanOutcome("acme", roster, null, null)} />);
    expect(screen.getByText("+4 more stars")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
