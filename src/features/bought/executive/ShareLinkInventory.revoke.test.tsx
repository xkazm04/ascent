// @vitest-environment jsdom
//
// Revoking from the issued-links panel: the destructive half. The reading half is in
// ShareLinkInventory.dom.test.tsx (split for the 200-LOC cap under src/features).
//
// What these pin: that the first click only WARNS, that the row re-renders from the response rather
// than a re-read, that a failed ledger write puts the row back instead of lying, that an unreadable
// list still lets an owner kill a link by id, and that a freshly minted link lands in the list.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BriefingShareGrant } from "@/lib/db/org-share";
import { ShareLinkInventory } from "./ShareLinkInventory";
import { publishMintedShareGrant } from "./useShareLinks";

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

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];

function stubFetch(opts: { grants?: BriefingShareGrant[]; getStatus?: number; revokeStatus?: number } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (method === "GET") {
      const status = opts.getStatus ?? 200;
      return {
        ok: status < 400,
        status,
        json: async () => (status < 400 ? { grants: opts.grants ?? [] } : { error: "Share links require a database." }),
      } as Response;
    }
    const status = opts.revokeStatus ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => (status < 400 ? { ok: true, jti: "x" } : { error: "Could not revoke the link. Try again." }),
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
const of = (method: string) => calls.filter((c) => c.method === method);

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShareLinkInventory revoke", () => {
  // Acceptance 2: the revoke endpoint gets its first caller, and the row re-renders without a reload.
  it("states what revoking does, then POSTs the jti and re-renders the row as Revoked", async () => {
    stubFetch({ grants: [grant()] });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("jti-live")).toBeTruthy());

    fireEvent.click(within(row("jti-live")).getByRole("button", { name: /^Revoke$/ }));
    // The warning is the point: the link is held by someone outside the org, and this cannot be undone.
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(of("POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Revoke now/i }));
    await waitFor(() => expect(within(row("jti-live")).getByText("Revoked")).toBeTruthy());
    expect(of("POST")).toEqual([
      { url: "/api/org/briefing/share/revoke", method: "POST", body: { org: "acme", jti: "jti-live" } },
    ]);
    // No second GET is required for the row to be correct.
    expect(of("GET")).toHaveLength(1);
    expect(within(row("jti-live")).queryByRole("button", { name: /^Revoke$/ })).toBeNull();
  });

  it("puts the row back and says so when the revoke POST fails", async () => {
    stubFetch({ grants: [grant()], revokeStatus: 500 });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("jti-live")).toBeTruthy());
    fireEvent.click(within(row("jti-live")).getByRole("button", { name: /^Revoke$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Revoke now/i }));
    await waitFor(() => expect(screen.getByText(/Could not revoke the link/i)).toBeTruthy());
    expect(within(row("jti-live")).getByText("Live")).toBeTruthy();
    expect(within(row("jti-live")).getByRole("button", { name: /^Revoke$/ })).toBeTruthy();
  });

  // Acceptance 6: an unreadable ledger is not an empty inventory, and must not disarm the owner.
  it("says the inventory could not be read, never no-links-issued, and keeps revoke-by-id usable", async () => {
    stubFetch({ getStatus: 503 });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(screen.getByText(/could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/No briefing links issued/i)).toBeNull();
    const field = screen.getByLabelText(/Link id/i) as HTMLInputElement;
    expect(field.disabled).toBe(false);
    fireEvent.change(field, { target: { value: "aged-out-jti" } });
    fireEvent.click(screen.getByRole("button", { name: /Revoke by id/i }));
    fireEvent.click(screen.getByRole("button", { name: /Revoke now/i }));
    await waitFor(() => expect(of("POST")).toHaveLength(1));
    expect(of("POST")[0].body).toEqual({ org: "acme", jti: "aged-out-jti" });
  });

  // Acceptance 7, second half: the endpoint deliberately does not require the grant to be listed.
  it("revokes a grant that is not in the list at all, by pasted id", async () => {
    stubFetch({ grants: [grant()] });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("jti-live")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Link id/i), { target: { value: "  older-than-retention  " } });
    fireEvent.click(screen.getByRole("button", { name: /Revoke by id/i }));
    expect(screen.getByText(/not in the list above/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Revoke now/i }));
    await waitFor(() => expect(screen.getByText(/older-than-retention/)).toBeTruthy());
    expect(of("POST")[0].body).toEqual({ org: "acme", jti: "older-than-retention" });
  });

  // Acceptance 8: the minted URL stops living only in the clipboard.
  it("prepends a link the Share button just minted", async () => {
    stubFetch({ grants: [grant({ jti: "existing" })] });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("existing")).toBeTruthy());
    publishMintedShareGrant({
      org: "acme",
      jti: "fresh",
      expiresAt: Date.parse("2026-10-12T00:00:00.000Z"),
      mintedBy: "ada",
      segment: "acme-bank",
      stack: null,
    });
    await waitFor(() => expect(row("fresh")).toBeTruthy());
    const order = [...document.querySelectorAll("tr[data-jti]")].map((n) => n.getAttribute("data-jti"));
    expect(order).toEqual(["fresh", "existing"]);
    expect(within(row("fresh")).getByText(/expires 2026-10-12/)).toBeTruthy();
    expect(within(row("fresh")).getByText("Segment acme-bank")).toBeTruthy();
    expect(within(row("fresh")).getByText("Not opened yet")).toBeTruthy();
    // No re-GET: the mint response is the row.
    expect(of("GET")).toHaveLength(1);
  });

  it("ignores a mint published for another org", async () => {
    stubFetch({ grants: [grant({ jti: "existing" })] });
    render(<ShareLinkInventory org="acme" canShare />);
    await waitFor(() => expect(row("existing")).toBeTruthy());
    publishMintedShareGrant({ org: "other", jti: "foreign", expiresAt: null });
    await waitFor(() => expect(document.querySelectorAll("tr[data-jti]")).toHaveLength(1));
  });
});
