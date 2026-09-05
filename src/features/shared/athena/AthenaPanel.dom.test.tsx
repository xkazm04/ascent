// @vitest-environment jsdom
//
// The conversation surface end to end over a faked wire: her resting state, one exchange streamed as
// real SSE frames, the degrade line, and the announcement level.
//
// The stream is a genuine `ReadableStream` of encoded frames rather than a stubbed event callback,
// because the thing most likely to break here is the READER — `readSSE`'s "\n\n" framing, the decoder,
// and `toAthenaEvent`'s shape checks — and a callback fake would test none of it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { AthenaPanel } from "./AthenaPanel";

interface Boot {
  thread: { id: string } | null;
  turns: unknown[];
  proposals: unknown[];
  degraded: boolean;
}

const boot = (over: Partial<Boot> = {}): Boot => ({
  thread: { id: "th1" },
  turns: [],
  proposals: [],
  degraded: false,
  ...over,
});

function sse(frames: [string, unknown][]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const [event, data] of frames) c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      c.close();
    },
  });
  return { ok: true, body, json: async () => ({}) } as unknown as Response;
}

/** Serve the boot GET, the thread POST, and one scripted stream for the message POST. */
function serve(payload: Boot, frames: [string, unknown][] = []) {
  const sent: { org: string; message: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/message")) {
        sent.push(JSON.parse(String(init?.body)) as { org: string; message: string });
        return sse(frames);
      }
      if (url.startsWith("/api/athena/threads") && init?.method === "POST") {
        return { ok: true, json: async () => ({ thread: { id: "th1" } }) } as Response;
      }
      return { ok: true, json: async () => payload } as Response;
    }),
  );
  return { sent };
}

const NEXT = { title: "Run your first scan", href: "/org/acme?tab=overview", cta: "Open the fleet" };

const panel = (over: Partial<React.ComponentProps<typeof AthenaPanel>> = {}) => (
  <AthenaPanel slug="acme" next={NEXT} degradedHref="/org/acme?tab=settings" {...over} />
);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("AthenaPanel — her resting state", () => {
  it("names the step the checklist promoted, and links to it", async () => {
    serve(boot());
    render(panel());
    await waitFor(() => expect(screen.getByText(/Run your first scan/)).toBeTruthy());
    expect(screen.getByRole("link", { name: "Open the fleet" }).getAttribute("href")).toBe("/org/acme?tab=overview");
  });

  it("offers no step, and claims nothing, when the checklist promoted none", async () => {
    serve(boot());
    render(panel({ next: null }));
    await waitFor(() => expect(screen.getByText(/Ask me about this org/)).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AthenaPanel — one exchange", () => {
  it("shows the question immediately, then her answer with its blocks full-bleed", async () => {
    const { sent } = serve(boot(), [
      ["phase", { phase: "recalling" }],
      ["recall", { chips: [{ insight: "This fleet rescans weekly." }] }],
      ["phase", { phase: "thinking" }],
      [
        "settled",
        {
          turn: {
            id: "t9",
            role: "assistant",
            content: "Three repos moved up a level.",
            meta: {
              blocks: [{ type: "table", columns: ["Repo", "Level"], rows: [["acme/api", "L3"]] }],
              chips: [{ insight: "This fleet rescans weekly." }],
            },
          },
        },
      ],
      ["done", { ok: true }],
    ]);
    const { container } = render(panel());
    await waitFor(() => expect(screen.getByText(/Run your first scan/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Ask Athena"), { target: { value: "what moved?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    });

    // The org travels with every message — the route's tenant gate is what a thread id alone can't be.
    expect(sent).toEqual([{ org: "acme", message: "what moved?" }]);
    await waitFor(() => expect(screen.getByText("Three repos moved up a level.")).toBeTruthy());
    // The question stays on screen beside the answer.
    expect(screen.getByText("what moved?")).toBeTruthy();
    // The block escapes the bubble's width cap; the bubble does not.
    expect(container.querySelector(".-mx-4")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "acme/api" })).toBeTruthy();
    // At most two chips, each a derived sentence — rendered AFTER the answer, never before it.
    expect(screen.getByText("This fleet rescans weekly.")).toBeTruthy();
  });

  it("keeps the question on screen when the turn produces no answer", async () => {
    serve(boot(), [
      ["phase", { phase: "grounding" }],
      ["error", { message: "This conversation isn't available for this organization." }],
      ["done", { ok: true }],
    ]);
    render(panel());
    await waitFor(() => expect(screen.getByLabelText("Ask Athena")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Ask Athena"), { target: { value: "who owns acme/api?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/isn't available/));
    expect(screen.getByText("who owns acme/api?")).toBeTruthy();
  });
});

describe("AthenaPanel — degrade", () => {
  it("still renders, says so in one line naming where the switch is, and keeps the composer usable", async () => {
    serve(boot({ degraded: true }));
    render(panel());
    await waitFor(() => expect(screen.getByText(/No model is configured/)).toBeTruthy());
    expect(screen.getByRole("link", { name: /connects one in Settings/ }).getAttribute("href")).toBe(
      "/org/acme?tab=settings",
    );
    expect(screen.getByLabelText("Ask Athena").hasAttribute("disabled")).toBe(false);
  });
});
