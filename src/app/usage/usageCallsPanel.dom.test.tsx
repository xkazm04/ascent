/** @vitest-environment jsdom */

// The calls panel: failed calls stand apart with their cost, every unpriced call says its one reason,
// and only an unknown model carries a fix line.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { UsageEventRow } from "@/lib/db/usage-events";
import type { LedgerCalls } from "@/lib/db/usage-ledger-read";
import { CallsPanel } from "./usageCallsPanel";

const row = (o: Partial<UsageEventRow>): UsageEventRow => ({
  id: "e", lane: "athena", legKind: null, refId: null, repoFullName: "acme/api", teamKey: null,
  provider: "anthropic", model: "claude-sonnet-4", byom: null, inputTokens: 1000, outputTokens: 200,
  costMicros: 2_500_000, status: "success", latencyMs: 40, createdAt: "2026-10-21T14:03:00.000Z", ...o,
});

const ledger = (rows: UsageEventRow[], extra: Partial<LedgerCalls> = {}): LedgerCalls => ({
  rows,
  calls: rows.length,
  unpricedGroups: [],
  ...extra,
});

const draw = (calls: LedgerCalls | null, filter = { kind: "lane", lane: "athena" } as const) =>
  render(<CallsPanel org="acme" days={30} filter={filter} calls={calls} />);

describe("the calls panel", () => {
  it("renders a failed call under 'Failed calls' with its cost, never in the priced list", () => {
    draw(ledger([row({ id: "ok" }), row({ id: "bad", status: "error", costMicros: 900_000, model: "claude-haiku-4" })]));
    const failed = screen.getByRole("region", { name: "Failed calls" });
    expect(within(failed).getByText(/claude-haiku-4/)).toBeInTheDocument();
    expect(within(failed).getByText("$0.90")).toBeInTheDocument();
    const priced = screen.getByRole("region", { name: "Priced calls" });
    expect(within(priced).queryByText(/claude-haiku-4/)).toBeNull();
    expect(within(priced).getByText("$2.50")).toBeInTheDocument();
  });

  it("tags each unpriced call with its reason; only the unknown model gets the fix line", () => {
    draw(
      ledger([row({ id: "b", byom: true, costMicros: null }), row({ id: "m", model: "mystery-1", costMicros: null })], {
        unpricedGroups: [
          { provider: "anthropic", model: "claude-sonnet-4", byom: true, tokensReported: true, calls: 38 },
          { provider: "anthropic", model: "mystery-1", byom: null, tokensReported: true, calls: 7 },
        ],
        calls: 45,
      }),
    );
    const unpriced = screen.getByRole("region", { name: "Unpriced calls" });
    const rows = within(unpriced).getAllByTestId("call-row");
    expect(rows[0]!.textContent).toMatch(/Your provider account/);
    expect(rows[0]!.textContent).not.toMatch(/Fix:/);
    expect(rows[1]!.textContent).toMatch(/Unknown model/);
    expect(rows[1]!.textContent).toMatch(/Fix:/);
    const summary = screen.getByRole("list", { name: "Why calls are unpriced" });
    expect(summary.textContent).toMatch(/38/);
    expect(summary.textContent).toMatch(/7/);
    expect(screen.getByText(/the 2 most expensive are listed/)).toBeInTheDocument();
  });

  it("says the read failed rather than rendering an empty ledger", () => {
    draw(null);
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });

  it("says scan-lane calls live in the Scan ledger", () => {
    draw(ledger([]), { kind: "lane", lane: "scan" } as never);
    expect(screen.getByText(/counted from stored scans/)).toBeInTheDocument();
  });

  it("offers a close link back to the same window and carries no em dash", () => {
    const { container } = draw(ledger([row({ byom: true, costMicros: null })]));
    expect(screen.getByRole("link", { name: "Close" }).getAttribute("href")).toBe("/usage?org=acme&days=30");
    expect(container.textContent).not.toContain("\u2014");
  });
});
