// @vitest-environment jsdom

// The whole-trail integrity sweep, end to end in the viewer: verify() asks /api/audit/integrity with the
// APPLIED filters, a filter change drops a summary that no longer describes the rows, "Show tampered"
// swaps the table to the sweep's rows and Back restores the paged trail untouched, and the page-level
// banner says "on this page" instead of reading like a verdict on the trail.

import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AuditLogEntry, AuditLogPage } from "@/lib/db";

const EM_DASH = String.fromCharCode(0x2014);

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));

const { AuditLogViewer } = await import("./AuditLogViewer");

const entry = (id: string, integrity: AuditLogEntry["integrity"] = "ok"): AuditLogEntry => ({
  id,
  action: "scan.created",
  actorId: `actor-${id}`,
  orgId: "org_1",
  at: new Date().toISOString(),
  meta: {},
  scan: null,
  integrity,
});
const page = (entries: AuditLogEntry[], nextCursor: string | null = null): AuditLogPage => ({ entries, nextCursor });
const summary = (over: Record<string, unknown> = {}) => ({
  scanned: 3, ok: 3, unsigned: 0, tampered: 0, noSecret: 0, truncated: false, tamperedEntries: [], cap: 10000, ...over,
});
const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

function stubFetch(handler: (url: string) => unknown) {
  const fetchMock = vi.fn(async (url: string) => json(handler(String(url))));
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}
const integrityCalls = (m: ReturnType<typeof stubFetch>) =>
  m.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/audit/integrity"));
const verifyButton = () => screen.getAllByRole("button", { name: "Verify all matching entries" })[0]!;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAuditIntegritySweep through the viewer", () => {
  it("verify() sends the APPLIED filters, not typed-but-unapplied inputs", async () => {
    const f = stubFetch((u) => (u.startsWith("/api/audit/integrity") ? summary() : page([])));
    render(<AuditLogViewer org="acme" initial={page([entry("a")])} />);
    fireEvent.change(screen.getByLabelText("Filter by actor"), { target: { value: "mallory" } });
    fireEvent.click(verifyButton());
    await waitFor(() => expect(screen.getByText("3 of 3 verified")).toBeInTheDocument());
    expect(integrityCalls(f)).toEqual(["/api/audit/integrity?org=acme"]);
  });

  it("a change of applied filters drops the summary so it never sits beside rows it did not check", async () => {
    const f = stubFetch((u) => (u.startsWith("/api/audit/integrity") ? summary() : page([entry("m")])));
    render(<AuditLogViewer org="acme" initial={page([entry("a")])} />);
    fireEvent.click(verifyButton());
    await waitFor(() => expect(screen.getByText("3 of 3 verified")).toBeInTheDocument());
    const input = screen.getByLabelText("Filter by actor");
    fireEvent.change(input, { target: { value: "mallory" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.queryByText("3 of 3 verified")).toBeNull());
    expect(screen.getByText(/filters changed/i)).toBeInTheDocument();
    fireEvent.click(verifyButton());
    await waitFor(() => expect(integrityCalls(f)).toHaveLength(2));
    expect(integrityCalls(f)[1]).toContain("actorId=mallory");
  });
});

describe("Show tampered / back to trail", () => {
  it("switches the table to the sweep's tampered rows, and Back restores the paged rows and cursor", async () => {
    const bad = entry("old-bad", "tampered");
    stubFetch(() => summary({ scanned: 40, ok: 39, tampered: 1, tamperedEntries: [bad] }));
    render(<AuditLogViewer org="acme" initial={page([entry("p1"), entry("p2")], "cur-1")} />);
    fireEvent.click(verifyButton());
    const show = await screen.findByRole("button", { name: "Show the 1 tampered" });
    fireEvent.click(show);

    expect(screen.getByText("actor-old-bad")).toBeInTheDocument();
    expect(screen.queryByText("actor-p1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(screen.getByTestId("tampered-view").textContent).toBe("Showing 1 tampered entry - back to trail");

    fireEvent.click(screen.getByRole("button", { name: "back to trail" }));
    expect(screen.getByText("actor-p1")).toBeInTheDocument();
    expect(screen.getByText("actor-p2")).toBeInTheDocument();
    expect(screen.queryByText("actor-old-bad")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("a partial sweep names the cap and is never shown as clean", async () => {
    stubFetch(() => summary({ scanned: 10000, ok: 10000, truncated: true }));
    render(<AuditLogViewer org="acme" initial={page([entry("a")])} />);
    fireEvent.click(verifyButton());
    const strip = await screen.findByTestId("integrity-strip");
    expect(strip.textContent).toContain("10,000-entry cap");
    expect(strip.textContent).not.toContain("of 10,000 verified");
    expect(strip.textContent).not.toContain(EM_DASH);
  });
});

describe("AuditLogTable page banner", () => {
  it("says 'on this page' and offers the whole-trail check when no sweep has run", () => {
    render(<AuditLogViewer org="acme" initial={page([entry("a"), entry("b", "tampered")])} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("1 entry on this page does not match");
    expect(alert.textContent).not.toContain(EM_DASH);
    expect(within(alert).getByRole("button", { name: "Verify all matching entries" })).toBeInTheDocument();
  });

  it("drops the banner's verify action once a sweep is in", async () => {
    stubFetch(() => summary({ scanned: 2, ok: 1, tampered: 1, tamperedEntries: [entry("b", "tampered")] }));
    render(<AuditLogViewer org="acme" initial={page([entry("a"), entry("b", "tampered")])} />);
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Verify all matching entries" }));
    await screen.findByRole("button", { name: "Show the 1 tampered" });
    const pageBanner = screen.getAllByRole("alert").find((a) => a.textContent?.includes("on this page"))!;
    expect(within(pageBanner).queryByRole("button")).toBeNull();
  });
});
