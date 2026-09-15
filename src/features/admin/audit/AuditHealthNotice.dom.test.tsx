// @vitest-environment jsdom
//
// The notice is the whole point of counting failed audit writes: a counter nobody sees is the state we
// started from. So this pins the two states that matter — it appears at n>0 (as an assertive alert, with
// the count and the "on this instance" qualifier the per-process counter requires), and it renders
// NOTHING at 0, so the tab isn't carrying a permanent "0 failures" badge readers learn to skim past.
//
// Kept beside AuditLogViewer.dom.test.tsx rather than inside it: both files stay well under the 200-LOC
// cap src/features/** carries, and the notice is a separate component with its own theme.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuditHealth } from "@/lib/db/audit-health";
import { AuditHealthNotice } from "./AuditHealthNotice";

const health = (over: Partial<AuditHealth> = {}): AuditHealth => ({
  failed: 0,
  since: null,
  lastAction: null,
  lastError: null,
  ...over,
});

describe("AuditHealthNotice", () => {
  it("renders nothing when no audit write has failed", () => {
    const { container } = render(<AuditHealthNotice health={health()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders an alert naming the count, the window start and the per-instance caveat at n>0", () => {
    render(
      <AuditHealthNotice
        health={health({
          failed: 3,
          since: "2026-09-04T07:08:09.000Z",
          lastAction: "scan.created",
          lastError: "connection reset",
        })}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("3 audit writes have failed on this instance");
    // An absolute UTC instant, quotable by an examiner — not a locale-dependent relative time.
    expect(alert).toHaveTextContent("2026-09-04 07:08:09 UTC");
    expect(alert).toHaveTextContent("known gaps");
    expect(alert).toHaveTextContent("scan.created");
    expect(alert).toHaveTextContent("connection reset");
    // The counter is per process; the copy must not imply a fleet-wide total.
    expect(alert).toHaveTextContent(/per process/i);
  });

  it("says it in the singular for exactly one failure", () => {
    render(<AuditHealthNotice health={health({ failed: 1, since: "2026-09-04T07:08:09.000Z" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 audit write has failed on this instance");
  });
});
