// @vitest-environment jsdom
//
// Pins goals-initiatives #4: a long tracked-initiative title truncates to one line (within its
// min-w-0 flex item) instead of overflowing the row / shoving the status <select>.
// Also pins the CLIENT half of the optimistic-lock protocol (ambiguity-ui 07-16 goals #3): every
// PATCH carries `expected` (the row's last-seen values for exactly the fields being written) and a
// 409 refetches the authoritative list + surfaces a retry message instead of a generic failure.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InitiativesPanel, type InitiativeView } from "./InitiativesPanel";

afterEach(() => vi.restoreAllMocks());

function initiative(over: Partial<InitiativeView> = {}): InitiativeView {
  return {
    id: "i1",
    title: "Add tests",
    dimId: "D1",
    dimLabel: "Testing",
    practiceId: null,
    targetScore: 70,
    repos: ["acme/web"],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    goalId: null,
    goalLabel: null,
    playbookId: null,
    playbookLabel: null,
    progress: { atTarget: 1, total: 3 },
    ...over,
  };
}

describe("InitiativesPanel", () => {
  it("#4: truncates a long initiative title with the full text on hover", () => {
    const long = "L".repeat(200);
    render(<InitiativesPanel slug="acme" initial={[initiative({ title: long })]} seeds={[]} />);
    const title = screen.getByText(long);
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", long);
    expect(title.parentElement).toHaveClass("min-w-0"); // the flex ancestor that lets it shrink
  });

  it("optimistic-lock #3: a status PATCH sends `expected` carrying the last-seen value of only that field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InitiativesPanel slug="acme" initial={[initiative({ status: "open" })]} seeds={[]} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Status for Add tests" }), { target: { value: "done" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/org/initiatives/i1");
    expect(JSON.parse(init.body)).toEqual({ status: "done", expected: { status: "open" } });
  });

  it("optimistic-lock #3: a 409 refetches the authoritative list and surfaces a concurrent-change retry message", async () => {
    const reloaded = [initiative({ status: "in_progress" })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Initiative changed concurrently — refresh and retry." }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ initiatives: reloaded }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InitiativesPanel slug="acme" initial={[initiative({ status: "open" })]} seeds={[]} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Status for Add tests" }), { target: { value: "done" } });

    await waitFor(() => expect(screen.getByText(/changed concurrently\. The list was reloaded/)).toBeInTheDocument());
    // The follow-up GET pulled the authoritative snapshot (what the concurrent editor persisted).
    expect(fetchMock.mock.calls[1][0]).toBe("/api/org/initiatives?org=acme");
    expect((screen.getByRole("combobox", { name: "Status for Add tests" }) as HTMLSelectElement).value).toBe("in_progress");
  });
});
