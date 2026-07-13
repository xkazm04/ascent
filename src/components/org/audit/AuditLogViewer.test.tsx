// @vitest-environment jsdom
//
// security-posture-audit-log #6: applying a filter fired a fetch but gave NO loading feedback, so the
// previous (now-stale) rows sat there looking authoritative until the new page landed. This pins that an
// in-flight fetch marks the results region aria-busy and shows an announced "Loading…" indicator while the
// stale rows are dimmed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuditLogViewer } from "./AuditLogViewer";
import type { AuditLogPage } from "@/lib/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const INITIAL: AuditLogPage = {
  entries: [
    {
      id: "a1",
      action: "scan.created",
      actorId: "octocat",
      orgId: "o1",
      at: new Date().toISOString(),
      meta: {},
      scan: null,
    },
  ],
  nextCursor: null,
};

describe("AuditLogViewer loading feedback while filtering", () => {
  it("marks the region busy and shows an announced Loading indicator during an in-flight apply", () => {
    // A fetch that never resolves keeps the component in its loading state so we can observe it.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<AuditLogViewer org="acme" initial={INITIAL} />);

    // No loading indicator at rest.
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Announced loading state...
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading…");
    // ...over a region marked busy...
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    // ...while the stale row is still on screen (dimmed, not yanked).
    expect(screen.getByText("octocat")).toBeInTheDocument();
  });
});
