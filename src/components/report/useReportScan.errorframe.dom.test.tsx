// @vitest-environment jsdom
//
// The SSE `error` frame mapping in useReportScan: code NOT_FOUND becomes the `notFound` class; any
// other code (or none) settles as a plain error carrying the frame's message.

import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { useReportScan } from "./useReportScan";

function sseStub() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  const enc = new TextEncoder();
  return {
    body,
    push: (event: string, data: unknown) =>
      act(() => { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }),
    close: () => act(() => { controller.close(); }),
  };
}

async function errorState(frame: Record<string, unknown>) {
  const sse = sseStub();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, body: sse.body, headers: new Headers(), json: async () => null }) as unknown as Response),
  );
  const { result } = renderHook(() => useReportScan("acme/app", true));
  await waitFor(() => expect(result.current.state.status).toBe("loading"));
  await sse.push("error", frame);
  await waitFor(() => expect(result.current.state.status).toBe("error"));
  sse.close();
  return result.current.state as { status: "error"; message: string; notFound?: boolean };
}

afterEach(() => vi.unstubAllGlobals());

describe("useReportScan — SSE error frame mapping", () => {
  it("NOT_FOUND becomes notFound", async () => {
    const state = await errorState({ error: "Repository not found.", code: "NOT_FOUND" });
    expect(state.notFound).toBe(true);
  });

  it("any other code becomes its error message, not notFound", async () => {
    const state = await errorState({ error: "Upstream exploded.", code: "RATE_LIMITED" });
    expect(state.message).toBe("Upstream exploded.");
    expect(state.notFound).toBeFalsy();
  });

  it("a frame with no code keeps its message", async () => {
    const state = await errorState({ error: "Unexpected error while scanning the repository." });
    expect(state.message).toBe("Unexpected error while scanning the repository.");
    expect(state.notFound).toBeFalsy();
  });
});
