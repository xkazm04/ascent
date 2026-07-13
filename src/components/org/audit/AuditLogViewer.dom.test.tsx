// @vitest-environment jsdom

// Locks the two audit-viewer defects the app-shell scan flagged:
//   1. EMPTY STATE — the hand-rolled "No entries" card is now routed through the shared EmptyState
//      primitive, so it stays visually consistent with every other empty surface in the product.
//   2. BOUNDED CELLS — a hostile-length actor login or scan repo name must TRUNCATE inside a fixed
//      max-width cell (with the full value on `title`), so one outlier row can't blow out the table.
//
// jest-dom matchers + auto-cleanup come from vitest.setup.dom.js. next/link is mocked to a plain
// anchor so the scan-detail permalink renders without an App Router context.

import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
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
