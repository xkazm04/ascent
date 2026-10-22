// @vitest-environment jsdom
//
// credits-1: the popover names the watched repos that missed a scan for credits and resumes them with
// the EXISTING capped POST /api/org/scan { repos }, stating what it draws before the click.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CreditsControl } from "@/components/org/shared/CreditsControl";

const repos = ["acme/a", "acme/b", "acme/c", "acme/d"].map((repo, i) => ({
  repo,
  skippedAt: `2026-10-0${i + 3}T10:00:00.000Z`,
  via: "cadence",
}));

function creditsBody(over: Record<string, unknown> = {}) {
  return {
    balance: 2,
    unlimited: false,
    plan: "free",
    allowanceRemaining: 2,
    ledger: [],
    creditBacklog: { count: 4, repos, oldestSkippedAt: repos[0].skippedAt },
    ...over,
  };
}

let scanBodies: unknown[] = [];
function stubFetch(body: Record<string, unknown>) {
  scanBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/org/scan") {
        scanBodies.push(JSON.parse(String(init?.body)));
        // Never resolves within the test: the run stays "in flight", which is what a double click hits.
        return new Promise(() => {});
      }
      return { ok: true, json: async () => body };
    }),
  );
}

function open(balance = 2) {
  render(<CreditsControl org="acme" initialBalance={balance} unlimited={false} grantsEnabled={false} allowanceRemaining={2} />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${balance} credits`) }));
}

beforeEach(() => stubFetch(creditsBody()));
afterEach(() => vi.unstubAllGlobals());

describe("CreditsControl credit backlog", () => {
  it("names the missed scans and states the draw before the click", async () => {
    open();
    const section = await screen.findByTestId("credit-backlog");
    expect(section.textContent).toContain("4 watched repos missed a scan for credits since Oct 3");
    const button = screen.getByRole("button", { name: "Scan 4 now - draws up to 2 credits" });
    expect(button).toBeInTheDocument();
    expect(section.textContent).not.toContain("—");
  });

  it("one click posts exactly the planned repos to /api/org/scan; a double click starts one run", async () => {
    open();
    const button = await screen.findByRole("button", { name: /^Scan 4 now/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(scanBodies).toHaveLength(1));
    expect(scanBodies[0]).toEqual({ org: "acme", repos: ["acme/a", "acme/b", "acme/c", "acme/d"] });
  });

  it("with no capacity the action is 'Top up first' and posts nothing", async () => {
    stubFetch(creditsBody({ balance: 0, allowanceRemaining: 0 }));
    open(0);
    const button = await screen.findByRole("button", { name: /Top up first/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(scanBodies).toHaveLength(0);
  });

  it("a backlog of 0 (or a viewer the server sent no backlog) renders no section", async () => {
    stubFetch(creditsBody({ creditBacklog: { count: 0, repos: [], oldestSkippedAt: null } }));
    open();
    await screen.findByText("private scans remaining");
    await screen.findByText("No activity yet.");
    expect(screen.queryByTestId("credit-backlog")).toBeNull();
  });
});
