// Route test for POST /api/athena/:id/message.
//
// THE ASSERTION THIS FILE EXISTS FOR is the cookie trap: `next/headers` is not readable inside a
// `ReadableStream`'s `start()`, so the viewer, the read decision and the plan must be resolved in
// REQUEST SCOPE, above `new ReadableStream`.
//
// "Above" is asserted LITERALLY: the test swaps in a `ReadableStream` subclass that timestamps its own
// construction, so the ordering check is `viewer → gates → new ReadableStream → turn` rather than a
// proxy for it. (Note that `start()` runs synchronously DURING construction, per the streams spec — so
// "the turn has not started yet when POST returns" would have been a false premise, not a test.)
//
// If those resolves were moved inside `start()`, this is the only thing in the suite that would
// notice: the stream would still open and she would still answer, ungrounded, with no error anywhere.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AthenaEvent } from "@/lib/athena/turn";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const h = vi.hoisted(() => ({
  gateAthenaOrg: vi.fn(async () => ({ org: "acme", orgId: "org-1" }) as unknown),
  resolveAthenaGates: vi.fn(async () => ({ canRead: true, memoryAllowed: true })),
  buildAthenaTurnDeps: vi.fn(() => ({}) as never),
  resolveViewerLogin: vi.fn(async () => "octocat"),
  getAthenaThread: vi.fn(async () => ({ id: "th1", orgId: "org-1", title: "Fleet", createdAt: "a", updatedAt: "b" })),
  events: [] as AthenaEvent[],
  runAthenaTurn: vi.fn(),
}));

vi.mock("@/app/api/athena/gate", () => ({
  gateAthenaOrg: h.gateAthenaOrg,
  resolveAthenaGates: h.resolveAthenaGates,
  buildAthenaTurnDeps: h.buildAthenaTurnDeps,
  refused: (v: unknown) => v instanceof Response,
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));
vi.mock("@/lib/db/athena", () => ({ getAthenaThread: h.getAthenaThread }));
vi.mock("@/lib/athena/turn", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena/turn")>("@/lib/athena/turn");
  return { ...actual, runAthenaTurn: h.runAthenaTurn };
});

const { POST } = await import("@/app/api/athena/[id]/message/route");

const post = (body: unknown, id = "th1") =>
  POST(new Request("http://x/api/athena/th1/message", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

/** Read an SSE body into `[eventName, payload]` pairs. */
async function frames(res: Response): Promise<[string, unknown][]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const name = /^event: (.*)$/m.exec(block)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "null";
      return [name, JSON.parse(data)] as [string, unknown];
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.gateAthenaOrg.mockResolvedValue({ org: "acme", orgId: "org-1" });
  h.resolveAthenaGates.mockResolvedValue({ canRead: true, memoryAllowed: true });
  h.resolveViewerLogin.mockResolvedValue("octocat");
  h.getAthenaThread.mockResolvedValue({ id: "th1", orgId: "org-1", title: "Fleet", createdAt: "a", updatedAt: "b" });
  h.runAthenaTurn.mockImplementation(async function* () {
    yield { type: "phase", phase: "recalling" } satisfies AthenaEvent;
    yield { type: "settled", turn: { id: "t2", threadId: "th1", role: "assistant", content: "62 of 100.", meta: {}, inputTokens: null, outputTokens: null, legs: null, createdAt: "c" } } satisfies AthenaEvent;
  });
});

describe("the cookie trap — request-scoped facts are resolved before the stream", () => {
  it("resolves the viewer and the gates BEFORE `new ReadableStream` is constructed", async () => {
    const order: string[] = [];
    h.resolveViewerLogin.mockImplementation(async () => {
      order.push("viewer");
      return "octocat";
    });
    h.resolveAthenaGates.mockImplementation(async () => {
      order.push("gates");
      return { canRead: true, memoryAllowed: true };
    });
    h.runAthenaTurn.mockImplementation(async function* () {
      order.push("turn");
      yield { type: "settled", turn: { id: "t2", threadId: "th1", role: "assistant", content: "ok", meta: {}, inputTokens: null, outputTokens: null, legs: null, createdAt: "c" } } satisfies AthenaEvent;
    });

    // Built BEFORE the spy is installed: a Request with a body constructs a ReadableStream of its own,
    // and counting that one would make the assertion meaningless.
    const request = new Request("http://x/api/athena/th1/message", {
      method: "POST",
      body: JSON.stringify({ org: "acme", message: "how is the fleet" }),
    });

    const Original = globalThis.ReadableStream;
    class Timestamped<T> extends Original<T> {
      constructor(...args: ConstructorParameters<typeof Original<T>>) {
        order.push("new ReadableStream");
        super(...args);
      }
    }
    globalThis.ReadableStream = Timestamped as unknown as typeof Original;
    let res: Response;
    try {
      res = await POST(request, { params: Promise.resolve({ id: "th1" }) });
    } finally {
      globalThis.ReadableStream = Original;
    }
    await frames(res);

    expect(order).toEqual(["viewer", "gates", "new ReadableStream", "turn"]);
  });

  it("closes the resolved viewer and gate decisions over the turn, not live predicates", async () => {
    await post({ org: "acme", message: "how is the fleet" });
    expect(h.buildAthenaTurnDeps).toHaveBeenCalledWith(
      expect.objectContaining({ org: "acme", orgId: "org-1", threadId: "th1", viewer: "octocat", canRead: true, memoryAllowed: true }),
    );
  });
});

describe("the preamble refuses with a STATUS, before the stream exists", () => {
  it("passes the gate's refusal through unchanged", async () => {
    h.gateAthenaOrg.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 403 }));
    const res = await post({ org: "acme", message: "hi" });
    expect(res.status).toBe(403);
    expect(h.resolveViewerLogin).not.toHaveBeenCalled();
  });

  it("400s an empty message rather than opening a stream to say nothing", async () => {
    expect((await post({ org: "acme", message: "   " })).status).toBe(400);
    expect(h.runAthenaTurn).not.toHaveBeenCalled();
  });

  it("400s a message past the ceiling", async () => {
    expect((await post({ org: "acme", message: "x".repeat(9000) })).status).toBe(400);
  });

  it("404s a thread id from another tenant — the id alone never crosses the boundary", async () => {
    h.getAthenaThread.mockResolvedValue(null);
    const res = await post({ org: "acme", message: "hi" }, "someone-elses-thread");
    expect(res.status).toBe(404);
    expect(h.getAthenaThread).toHaveBeenCalledWith("org-1", "someone-elses-thread");
    expect(h.runAthenaTurn).not.toHaveBeenCalled();
  });
});

describe("the stream is a pure adapter over the turn's events", () => {
  it("uses the SSE headers and names each frame after the event's own type", async () => {
    const res = await post({ org: "acme", message: "how is the fleet" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const f = await frames(res);
    expect(f.map(([name]) => name)).toEqual(["phase", "settled", "done"]);
    expect(f[0]?.[1]).toEqual({ type: "phase", phase: "recalling" });
    expect((f[1]?.[1] as { turn: { content: string } }).turn.content).toBe("62 of 100.");
  });

  it("hands the turn the trimmed message and the request's abort signal", async () => {
    await post({ org: "acme", message: "  how is the fleet  " });
    expect(h.runAthenaTurn).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: "acme", threadId: "th1", message: "how is the fleet", signal: expect.anything() }),
    );
  });

  it("delivers a mid-stream failure as an error FRAME — there is no status code left to change", async () => {
    h.runAthenaTurn.mockImplementation(async function* () {
      yield { type: "phase", phase: "thinking" } satisfies AthenaEvent;
      throw new Error("provider exploded");
    });
    const res = await post({ org: "acme", message: "hi" });
    expect(res.status).toBe(200); // the 200 was already on the wire
    const f = await frames(res);
    expect(f.map(([name]) => name)).toEqual(["phase", "error", "done"]);
    expect(f[1]?.[1]).toMatchObject({ type: "error", message: "provider exploded" });
  });

  it("always closes with `done`, so a client never has to time out to learn it is over", async () => {
    h.runAthenaTurn.mockImplementation(async function* () {
      yield { type: "error", message: "refused" } satisfies AthenaEvent;
    });
    const f = await frames(await post({ org: "acme", message: "hi" }));
    expect(f.at(-1)?.[0]).toBe("done");
  });
});
