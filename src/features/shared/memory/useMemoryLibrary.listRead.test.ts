// @vitest-environment jsdom
//
// A failed list read is never silent and never leaves the old rows under the new filter (council
// 2026-10-08 robustness-1). Mirrors useSkillsLibrary.listRead.test.ts.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMemoryLibrary } from "./useMemoryLibrary";
import type { MemoryRow } from "@/lib/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const memory = (id: string) => ({ id, namespace: "", content: "c", kind: "semantic", tags: [] }) as unknown as MemoryRow;
const ids = (r: { current: { memories: MemoryRow[] } }) => r.current.memories.map((m) => m.id);
const hook = () =>
  renderHook(() => useMemoryLibrary({ slug: "acme", initial: [memory("a"), memory("b")], initialNamespaces: [] }));
const failing = (error?: string) => vi.fn().mockResolvedValue({ ok: false, json: async () => (error ? { error } : {}) });

describe("useMemoryLibrary — failed list read", () => {
  it("a 500 after a filter change sets the list-read error and empties the rows", async () => {
    vi.stubGlobal("fetch", failing("Boom."));
    const { result } = hook();
    act(() => result.current.setSearch("x"));
    await waitFor(() => expect(result.current.listError).toBe("Boom."));
    expect(ids(result)).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("uses a fixed line when the failure carries no message, and the thrown message for a thrown fetch", async () => {
    vi.stubGlobal("fetch", failing());
    const { result } = hook();
    act(() => result.current.setSearch("x"));
    await waitFor(() => expect(result.current.listError).toBe("Couldn't load the list. Try again."));

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    act(() => result.current.setSearch("y"));
    await waitFor(() => expect(result.current.listError).toBe("network"));
    expect(ids(result)).toEqual([]);
  });

  it("an aborted refresh changes nothing", async () => {
    const fetchMock = vi.fn(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = hook();
    act(() => result.current.setSearch("x"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current.setSearch("xy"));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.listError).toBeNull();
    expect(ids(result)).toEqual(["a", "b"]);
  });

  it("the next successful refresh clears the error and lands its rows", async () => {
    vi.stubGlobal("fetch", failing());
    const { result } = hook();
    act(() => result.current.setSearch("x"));
    await waitFor(() => expect(result.current.listError).not.toBeNull());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memories: [memory("c")], namespaces: ["n"] }) }),
    );
    act(() => result.current.setSearch("z"));
    await waitFor(() => expect(result.current.listError).toBeNull());
    expect(ids(result)).toEqual(["c"]);
    expect(result.current.namespaces).toEqual(["n"]);
  });

  it("keeps the list-read error and the archive error apart", async () => {
    vi.stubGlobal("fetch", failing("Nope."));
    const { result } = hook();
    await act(async () => {
      await result.current.archive("a");
    });
    expect(result.current.error).toBe("Nope.");
    act(() => result.current.setSearch("x"));
    await waitFor(() => expect(result.current.listError).toBe("Nope."));
    expect(result.current.error).toBe("Nope.");

    vi.stubGlobal("fetch", failing("Admins."));
    await act(async () => {
      await result.current.archive("b");
    });
    expect(result.current.error).toBe("Admins.");
    expect(result.current.listError).toBe("Nope.");
  });
});
