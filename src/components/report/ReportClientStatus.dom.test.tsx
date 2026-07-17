// @vitest-environment jsdom
//
// Empty-state action primacy (repo-report-shell-tabs #4): for a permanent failure (404 / private,
// `connect: true`) a retry with the same input can't succeed — the `connect` prop's own doc says so —
// so "Connect GitHub" must be the primary action and the retry loop must not be offered. For a
// transient failure (no `connect`), "Try again" stays the primary.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Empty } from "./ReportClientStatus";
import { CTA_PRIMARY } from "@/lib/ui";

describe("Empty action primacy (permanent vs transient failure)", () => {
  it("connect: 'Connect GitHub' is primary, retry-same-input is not offered", () => {
    render(<Empty title="Repository not found" message="…" repo="acme/private" connect />);
    const connectLink = screen.getByRole("link", { name: /connect github/i });
    expect(connectLink.className).toBe(CTA_PRIMARY);
    // The dead-end loop is gone; a productive alternative replaces it.
    expect(screen.queryByRole("link", { name: /^try again$/i })).toBeNull();
    expect(screen.getByRole("link", { name: /scan a different repo/i })).toHaveAttribute("href", "/?scan=1");
    expect(screen.getByRole("link", { name: /back home/i })).toBeInTheDocument();
  });

  it("transient (no connect): 'Try again' with the same repo stays the primary action", () => {
    render(<Empty title="Scan timed out" message="…" repo="acme/app" />);
    const retry = screen.getByRole("link", { name: /^try again$/i });
    expect(retry.className).toBe(CTA_PRIMARY);
    expect(retry).toHaveAttribute("href", `/report?repo=${encodeURIComponent("acme/app")}`);
    expect(screen.queryByRole("link", { name: /connect github/i })).toBeNull();
  });
});
