// @vitest-environment jsdom
//
// security-posture-audit-log #6: applying a filter fired a fetch but gave NO loading feedback, so the
// previous (now-stale) rows sat there looking authoritative until the new page landed. This pins that an
// in-flight fetch marks the results region aria-busy and shows an announced "Loading…" indicator while the
// stale rows are dimmed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuditLogViewer } from "./AuditLogViewer";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";

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
      integrity: "ok",
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

function row(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "a1",
    action: "org.plan",
    actorId: "octocat",
    orgId: "o1",
    at: new Date().toISOString(),
    meta: {},
    scan: null,
    integrity: "ok",
    ...over,
  };
}

// G4: the em dash is the missing-measurement glyph, not a "this cell is empty" placeholder.
// Non-scan rows carry the act in `meta`; Details must print those scalars (and say so in words
// when nothing displayable was recorded) instead of looking like the payload was never stored.
describe("AuditLogViewer — Details for non-scan rows (G4)", () => {
  it("prints useful meta for plan, member-role and refused-PR rows instead of an em dash", () => {
    render(
      <AuditLogViewer
        org="acme"
        initial={{
          entries: [
            row({ id: "p", action: "org.plan", meta: { org: "acme", plan: "team", _sig: "deadbeef" } }),
            row({
              id: "m",
              action: "org.member.role",
              meta: { login: "alice", newRole: "admin", prevRole: "member" },
            }),
            row({
              id: "r",
              action: "loop.pr.refused",
              meta: { repoFullName: "acme/api", reason: "non-fast-forward", branch: "ascent/fix" },
            }),
          ],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByText(/plan: team/)).toBeInTheDocument();
    expect(screen.getByText(/login: alice/)).toBeInTheDocument();
    expect(screen.getByText(/newRole: admin/)).toBeInTheDocument();
    expect(screen.getByText(/repoFullName: acme\/api/)).toBeInTheDocument();
    expect(screen.getByText(/reason: non-fast-forward/)).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/org: acme/)).toBeNull();
    expect(screen.queryByText(/deadbeef/)).toBeNull();
  });

  it("keeps a writer-composed meta.status sentence as the details line", () => {
    render(
      <AuditLogViewer
        org="acme"
        initial={{
          entries: [
            row({
              id: "g",
              action: "org.gate_policy",
              meta: { status: "min overall 55 · dropped required controls", id: "pol_abcdef12" },
            }),
          ],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByText("min overall 55 · dropped required controls")).toBeInTheDocument();
    expect(screen.getByText(/pol_abcd/)).toBeInTheDocument();
  });

  it("says no details recorded when meta is empty or only a signature — never an em dash", () => {
    render(
      <AuditLogViewer
        org="acme"
        initial={{
          entries: [row({ id: "e", action: "retention.purged", meta: { _sig: "deadbeef" } })],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByText("no details recorded")).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/deadbeef/)).toBeNull();
  });
});
