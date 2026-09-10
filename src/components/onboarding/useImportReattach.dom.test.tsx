// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { REATTACH_POLL_MS, useImportReattach } from "./useImportReattach";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const pending = () => Response.json({ pending: 1, total: 1, repos: [{ repo: "acme/web", state: "claimed" }] });
function follow() {
  const onSettled = vi.fn();
  const onRows = vi.fn();
  return { ...renderHook(() => useImportReattach({ active: true, org: "acme", runId: "run-1", onRows, onSettled })), onSettled, onRows };
}
async function advance(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("import resume polling lifecycle", () => {
  it.each([
    null,
    {},
    { total: 0, repos: [] },
    { pending: null, total: 0, repos: [] },
    { pending: -1, total: 1, repos: [] },
    { pending: 0.5, total: 1, repos: [] },
    { pending: 2, total: 1, repos: [] },
    { pending: 0, total: "1", repos: [] },
    { pending: 0, total: 1, repos: [null] },
    { pending: 0, total: 1, repos: [{ repo: "acme/web" }] },
    { pending: 0, total: 1, repos: "invalid" },
  ])("does not declare an unreadable queue snapshot finished: %j", async (snapshot) => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(snapshot));
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled, onRows } = follow();
    await advance();
    expect(result.current.status).toBe("unavailable");
    expect(onSettled).not.toHaveBeenCalled();
    expect(onRows).not.toHaveBeenCalled();
    await advance(REATTACH_POLL_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops after an HTTP refusal without declaring the run finished", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled } = follow();
    await advance();
    expect(result.current.status).toBe("unavailable");
    await advance(REATTACH_POLL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("stops after settlement even when the caller keeps following active", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ pending: 0, total: 0, repos: [] }));
    vi.stubGlobal("fetch", fetch);
    const { result, onSettled } = follow();
    await advance();
    expect(result.current.status).toBe("settled");
    await advance(REATTACH_POLL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("never overlaps a slow queue read and resumes the cadence after it resolves", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }))
      .mockImplementation(async () => pending());
    vi.stubGlobal("fetch", fetch);
    follow();
    await advance(REATTACH_POLL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(pending()); });
    await advance(REATTACH_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a transient network failure on the next poll", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => pending());
    vi.stubGlobal("fetch", fetch);
    const { result } = follow();
    await advance();
    await advance(REATTACH_POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: "polling", pending: 1 });
  });

  it("aborts its pending request when the component unmounts", () => {
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = follow();
    const signal = fetch.mock.calls[0]![1]?.signal as AbortSignal | undefined;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
