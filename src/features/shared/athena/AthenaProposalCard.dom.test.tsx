// @vitest-environment jsdom
//
// Answering her offer where she made it, over a faked wire: the panel boots, the card under her turn
// offers Accept / Decline, and each answer the one door can give paints the card it should.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { AthenaPanel } from "./AthenaPanel";

const TURN = { id: "t1", threadId: "th1", role: "assistant", content: "That finding is a mirror.", meta: { proposalIds: ["p1"] }, createdAt: "c" };
const ask = (over: Record<string, unknown> = {}) => ({
  id: "p1", orgId: "org-1", threadId: "th1", turnId: "t1", kind: "rule_on_finding", status: "open",
  payload: { params: {} }, resolvedAt: null, resolvedBy: null, claimedAt: null, createdAt: "c",
  summary: "Dismiss Branch protection (acme/api) (security)", ...over,
});

interface Wire {
  boots: number;
  resolves: { url: string; body: unknown }[];
  answer: (r: Response) => void;
}

/** Boot GETs come from `boots` in order (the last repeats); resolve POSTs wait on `wire.answer`. */
function serve(boots: unknown[], frames: [string, unknown][] = []): Wire {
  let pending: ((r: Response) => void) | null = null;
  const wire: Wire = { boots: 0, resolves: [], answer: (r) => pending?.(r) };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/resolve")) {
      wire.resolves.push({ url, body: JSON.parse(String(init?.body)) });
      return new Promise<Response>((r) => { pending = r; });
    }
    if (url.includes("/message")) {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start(c) {
        for (const [e, d] of frames) c.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`));
        c.close();
      } });
      return { ok: true, body, json: async () => ({}) } as unknown as Response;
    }
    const payload = boots[Math.min(wire.boots, boots.length - 1)];
    wire.boots += 1;
    return { ok: true, status: 200, json: async () => payload } as Response;
  }));
  return wire;
}

const boot = (proposals: unknown[], turns: unknown[] = [TURN]) => ({ thread: { id: "th1" }, turns, proposals, degraded: false });
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
const panel = () => <AthenaPanel slug="acme" next={null} degradedHref="/org/acme?tab=settings" />;
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => vi.unstubAllGlobals());

describe("the card states the ask", () => {
  it("paints the server-resolved summary and offers Accept and Decline", async () => {
    serve([boot([ask()])]);
    render(panel());
    await waitFor(() => expect(screen.getByText("Dismiss Branch protection (acme/api) (security)")).toBeTruthy());
    expect(btn("Accept")).toBeTruthy();
    expect(btn("Decline")).toBeTruthy();
  });

  it("offers no Accept on an identity_diff", async () => {
    serve([boot([ask({ kind: "identity_diff", summary: null, payload: { ops: [{ op: "append" }] } })])]);
    render(panel());
    await waitFor(() => expect(btn("Decline")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(document.body.textContent).not.toContain("\u2014");
  });
});

describe("answering through the one door", () => {
  it("POSTs {org, decision} once, with both buttons disabled while it runs", async () => {
    const wire = serve([boot([ask()])]);
    render(panel());
    await waitFor(() => expect(btn("Accept")).toBeTruthy());
    await act(async () => { fireEvent.click(btn("Accept")); fireEvent.click(btn("Accept")); });
    expect(wire.resolves).toEqual([{ url: "/api/athena/proposals/p1/resolve", body: { org: "acme", decision: "accept" } }]);
    expect(btn("Accept").disabled).toBe(true);
    expect(btn("Decline").disabled).toBe(true);
  });

  it("paints a refusal outcome and removes the buttons", async () => {
    const wire = serve([boot([ask()])]);
    render(panel());
    await waitFor(() => expect(btn("Accept")).toBeTruthy());
    await act(async () => { fireEvent.click(btn("Accept")); });
    await act(async () => {
      wire.answer(reply(200, { id: "p1", status: "accepted", outcome: { ok: false, kind: "refused", detail: "Every one of those items had already moved on" }, summary: null }));
    });
    await waitFor(() => expect(screen.getByText("Every one of those items had already moved on")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("a 409 is answered elsewhere: the boot proposals are re-read and Accept never comes back", async () => {
    const wire = serve([boot([ask()]), boot([ask({ status: "declined", resolvedAt: "d", payload: { outcome: { ok: true, kind: "declined", detail: "Declined." } } })])]);
    render(panel());
    await waitFor(() => expect(btn("Accept")).toBeTruthy());
    await act(async () => { fireEvent.click(btn("Accept")); });
    await act(async () => { wire.answer(reply(409, { error: "That proposal has already been answered.", status: "declined" })); });
    await waitFor(() => expect(wire.boots).toBe(2));
    await waitFor(() => expect(screen.getByText(/^Answered elsewhere:/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("a 500 after the action failed returns the card to ask with the error beside it", async () => {
    const wire = serve([boot([ask()])]);
    render(panel());
    await waitFor(() => expect(btn("Accept")).toBeTruthy());
    await act(async () => { fireEvent.click(btn("Accept")); });
    await act(async () => { wire.answer(reply(500, { error: "The action failed. Nothing was changed." })); });
    await waitFor(() => expect(screen.getByText("The action failed. Nothing was changed.")).toBeTruthy());
    expect(btn("Accept").disabled).toBe(false);
  });
});

describe("offers raised in a live turn", () => {
  it("re-reads proposals once after a settled turn with proposalIds, and paints the new card", async () => {
    const settled = { ...TURN, id: "t2", meta: { proposalIds: ["p2"] } };
    const wire = serve([boot([], []), boot([ask({ id: "p2", turnId: "t2" })], [settled])], [
      ["settled", { turn: settled }],
      ["done", { ok: true }],
    ]);
    render(panel());
    await waitFor(() => expect(screen.getByLabelText("Ask Athena")).toBeTruthy());
    expect(wire.boots).toBe(1);
    fireEvent.change(screen.getByLabelText("Ask Athena"), { target: { value: "rule it" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask" })); });
    await waitFor(() => expect(btn("Accept")).toBeTruthy());
    expect(wire.boots).toBe(2);
  });
});
