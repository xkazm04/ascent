// @vitest-environment jsdom
//
// The issued-links panel as a READER sees it. The revoke half lives in ShareLinkInventory.revoke.test.tsx
// (one file per theme, each with its own mock setup, for the 200-LOC cap under src/features).
//
// shareLinkRows.test.ts pins the row model; these are the rules that only exist once the rows are on a
// page: that a non-owner issues no request at all, that an unreadable ledger is never dressed up as
// "nothing issued", and that the retention caveat the data layer wrote finally reaches a reader.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { BriefingShareGrant } from "@/lib/db/org-share";
import { ShareLinkInventory } from "./ShareLinkInventory";

const grant = (over: Partial<BriefingShareGrant> = {}): BriefingShareGrant => ({
  jti: "jti-live",
  mintedAt: "2026-09-20T10:00:00.000Z",
  mintedBy: "ada",
  expiresAt: "2026-09-27T10:00:00.000Z",
  window: { start: "2026-06-01T00:00:00.000Z", end: "2026-09-20T00:00:00.000Z" },
  segment: null,
  stack: null,
  revoked: false,
  expired: false,
  opens: 0,
  lastOpenedAt: null,
  ...over,
});

type Call = { url: string; method: string };
let calls: Call[] = [];

function stubFetch(opts: { grants?: BriefingShareGrant[]; getStatus?: number } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const status = opts.getStatus ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => (status < 400 ? { grants: opts.grants ?? [] } : { error: "Share links require a database." }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const row = (jti: string): HTMLElement => {
  const node = document.querySelector<HTMLElement>(`tr[data-jti="${jti}"]`);
  if (!node) throw new Error(`no row for ${jti}`);
  return node;
};

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShareLinkInventory", () => {
  // Acceptance 1: the GET that today has no caller in src/ reaches the owner's screen.
  it("renders every issued grant newest-first with its scope, window, expiry and opens", async () => {
    stubFetch({
      grants: [
        grant({ jti: "newer", mintedAt: "2026-09-20T10:00:00.000Z", segment: "acme-bank", opens: 3, lastOpenedAt: "2026-09-22T00:00:00.000Z" }),
        grant({ jti: "older", mintedAt: "2026-08-02T10:00:00.000Z", mintedBy: "grace" }),
      ],
    });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("newer")).toBeTruthy());
    const order = [...document.querySelectorAll("tr[data-jti]")].map((n) => n.getAttribute("data-jti"));
    expect(order).toEqual(["newer", "older"]);
    const first = within(row("newer"));
    expect(first.getByText("Segment acme-bank")).toBeTruthy();
    expect(first.getByText(/2026-06-01 to 2026-09-20/)).toBeTruthy();
    expect(first.getByText(/expires 2026-09-27/)).toBeTruthy();
    expect(first.getByText(/Opened 3 times, last 2026-09-22/)).toBeTruthy();
    expect(within(row("older")).getByText("grace")).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/org/briefing/share?org=acme");
  });

  // Acceptance 3 at the render layer.
  it("shows revoked and expired as different words, and offers Revoke on neither", async () => {
    stubFetch({
      grants: [
        grant({ jti: "dead", revoked: true }),
        grant({ jti: "stale", mintedAt: "2026-08-01T00:00:00.000Z", expired: true }),
        grant({ jti: "forever", mintedAt: "2026-07-01T00:00:00.000Z", expiresAt: null, expired: true }),
      ],
    });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("dead")).toBeTruthy());
    expect(within(row("dead")).getByText("Revoked")).toBeTruthy();
    expect(within(row("stale")).getByText("Expired")).toBeTruthy();
    expect(within(row("dead")).queryByRole("button", { name: /^Revoke$/ })).toBeNull();
    expect(within(row("stale")).queryByRole("button", { name: /^Revoke$/ })).toBeNull();
    // A mint row with no recorded expiry is still live, and still killable.
    expect(within(row("forever")).getByText("Live")).toBeTruthy();
    expect(within(row("forever")).getByRole("button", { name: /^Revoke$/ })).toBeTruthy();
  });

  // Acceptance 4 at the render layer: never a bare zero.
  it("says not opened yet rather than presenting a zero as health", async () => {
    stubFetch({ grants: [grant()] });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("jti-live")).toBeTruthy());
    expect(within(row("jti-live")).getByText("Not opened yet")).toBeTruthy();
    expect(within(row("jti-live")).queryByText("0")).toBeNull();
  });

  // Acceptance 5: the gate is on the server, and the client must not even knock.
  it("does not mount and issues no request for a viewer who cannot share", () => {
    const fetchMock = stubFetch({ grants: [grant()] });
    const { container } = render(<ShareLinkInventory org="acme" canShare={false} />);
    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the empty state only when the list really was read and was empty", async () => {
    stubFetch({ grants: [] });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(screen.getByText(/No briefing links issued/i)).toBeTruthy());
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });

  // Acceptance 7: the caveat org-share.ts wrote for a reader who never existed.
  it("states that the list is bounded by audit retention and is not the enforcement point", async () => {
    stubFetch({ grants: [grant()] });
    render(<ShareLinkInventory org="acme" canShare />);
    const note = await screen.findByText(/audit retention/i);
    expect(note.textContent).toMatch(/not the enforcement point/i);
    expect(note.textContent).toMatch(/paste/i);
  });
});
