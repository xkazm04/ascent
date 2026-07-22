// @vitest-environment jsdom

// Locks the two audit-viewer defects the app-shell scan flagged:
//   1. EMPTY STATE — the hand-rolled "No entries" card is now routed through the shared EmptyState
//      primitive, so it stays visually consistent with every other empty surface in the product.
//   2. BOUNDED CELLS — a hostile-length actor login or scan repo name must TRUNCATE inside a fixed
//      max-width cell (with the full value on `title`), so one outlier row can't blow out the table.
//
// jest-dom matchers + auto-cleanup come from vitest.setup.dom.js. next/link is mocked to a plain
// anchor so the scan-detail permalink renders without an App Router context.

import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));

// Imported after the mock is registered.
const { AuditLogViewer } = await import("./AuditLogViewer");

function entry(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "al_1",
    action: "scan.created",
    actorId: "octocat",
    orgId: "org_1",
    at: new Date().toISOString(),
    meta: {},
    scan: null,
    ...over,
  };
}

const page = (entries: AuditLogEntry[]): AuditLogPage => ({ entries, nextCursor: null });

describe("AuditLogViewer — unified empty state", () => {
  it("renders the shared EmptyState copy when no entries match the filter", () => {
    render(<AuditLogViewer org="acme" initial={page([])} />);
    expect(screen.getByText("No audit entries")).toBeInTheDocument();
    expect(screen.getByText("No entries match this filter.")).toBeInTheDocument();
  });
});

// security-posture-audit-log 2026-07-16 #5: the CSV link must follow the APPLIED filter set (what the
// table shows), never raw input state — typing an actor without pressing Apply previously changed the
// export while the on-screen rows stayed put (filed evidence ≠ reviewed rows). Enter in a filter field
// must submit (the row is a real <form> now).
describe("AuditLogViewer — CSV follows the applied filters (#5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const csvLink = () => screen.getByTitle("Download all matching entries as CSV") as HTMLAnchorElement;

  it("typing an actor WITHOUT applying does not change the CSV href", () => {
    render(<AuditLogViewer org="acme" initial={page([entry()])} />);
    const before = csvLink().getAttribute("href");
    fireEvent.change(screen.getByLabelText("Filter by actor"), { target: { value: "mallory" } });
    expect(csvLink().getAttribute("href")).toBe(before); // unapplied input never leaks into the export
    expect(before).not.toContain("actorId=");
  });

  it("pressing Enter in the actor field applies the filter — table load AND CSV href agree", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ entries: [], nextCursor: null }) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    render(<AuditLogViewer org="acme" initial={page([entry()])} />);
    const input = screen.getByLabelText("Filter by actor");
    fireEvent.change(input, { target: { value: "mallory" } });
    fireEvent.submit(input.closest("form")!); // Enter in the field submits the form
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("actorId=mallory");
    expect(csvLink().getAttribute("href")).toContain("actorId=mallory"); // now — and only now — the CSV follows
  });
});

describe("AuditLogViewer — bounded cells (no layout blow-out)", () => {
  it("truncates a hostile-length actor login in a fixed-width cell, full value on title", () => {
    const longActor = "a".repeat(160);
    render(<AuditLogViewer org="acme" initial={page([entry({ actorId: longActor })])} />);
    const cell = screen.getByText(longActor);
    expect(cell).toHaveClass("truncate");
    expect(cell).toHaveClass("max-w-[12rem]");
    expect(cell).toHaveAttribute("title", longActor);
  });

  it("truncates a hostile-length scan repo name in the details cell, full value on title", () => {
    const longRepo = "acme/" + "x".repeat(160);
    const scanEntry = entry({
      scan: { id: "s1", repo: longRepo, level: null, overall: null, headSha: null },
    });
    render(<AuditLogViewer org="acme" initial={page([scanEntry])} />);
    const repoEl = screen.getByText(longRepo);
    expect(repoEl).toHaveClass("truncate");
    expect(repoEl).toHaveAttribute("title", longRepo);
  });
});
